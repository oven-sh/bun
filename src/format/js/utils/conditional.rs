//! `a ? b : c` and `A extends B ? C : D`. Prettier's `printTernary`.

use super::typecast::{is_cast_target, is_cast_target_that_hides_its_kind};
use super::typescript::without_lone_operator;
use crate::js::format::format_node;
use crate::js::parentheses::expression::expression_needs_parentheses;
use crate::js::print::binary_like_expression::is_angular_pipe;
use crate::js::print::parameters::prettier_avoids_parentheses;
use crate::prelude::*;
use crate::write;

#[derive(Copy, Clone)]
pub(crate) enum ConditionalLike<'a> {
    ConditionalExpression(Expr<'a>),
    TSConditionalType(TypeNode<'a>),
}

/// An operand of either kind of conditional.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Operand<'a> {
    Expr(Expr<'a>),
    Type(TypeNode<'a>),
}

impl Spanned for Operand<'_> {
    fn span(&self) -> Span {
        match self {
            Operand::Expr(e) => e.span(),
            Operand::Type(ty) => ty.span(),
        }
    }
}

impl<'a> Format<'a> for Operand<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        match self {
            Operand::Expr(e) => e.fmt(f),
            Operand::Type(ty) => ty.fmt(f),
        }
    }
}

impl Operand<'_> {
    pub(super) fn is_conditional(self) -> bool {
        match self {
            Operand::Expr(e) => matches!(e.kind(), ExprKind::Cond { .. }),
            Operand::Type(ty) => matches!(ty.kind(), TypeKind::Cond { .. }),
        }
    }
}

impl<'a> ConditionalLike<'a> {
    fn parent(&self) -> AstNodes<'a> {
        match self {
            ConditionalLike::ConditionalExpression(e) => e.ast_parent(),
            ConditionalLike::TSConditionalType(ty) => ty.ast_parent(),
        }
    }

    /// The operands after the `?` and after the `:`.
    fn consequent_and_alternate(&self) -> Option<(Operand<'a>, Operand<'a>)> {
        match self {
            ConditionalLike::ConditionalExpression(e) => match e.kind() {
                ExprKind::Cond { yes, no, .. } => Some((Operand::Expr(yes), Operand::Expr(no))),
                _ => None,
            },
            ConditionalLike::TSConditionalType(ty) => match ty.kind() {
                TypeKind::Cond { yes, no, .. } => Some((Operand::Type(yes), Operand::Type(no))),
                _ => None,
            },
        }
    }
}

/// Prettier's `shouldExtraIndentForConditionalExpression`: true if `conditional` is the head of a chain of member
/// accesses and calls, and that chain is the whole value that's returned, assigned, etc.:
///
/// ```javascript
/// return (
///   a
///     ? b
///     : c
/// ).member;
/// ```
pub(super) fn should_extra_indent<'a>(conditional: Expr<'a>) -> bool {
    let mut expression = conditional;
    let mut parent = conditional.ast_parent();
    loop {
        let is = |head: Option<Expr<'a>>| head == Some(expression);
        match parent {
            AstNodes::ChainExpression(_) => {}
            AstNodes::StaticMemberExpression(e)
            | AstNodes::PrivateFieldExpression(e)
            | AstNodes::ComputedMemberExpression(e)
                if is(e.object()) =>
            {
                expression = e;
            }
            AstNodes::CallExpression(e) if is(e.callee()) => expression = e,
            AstNodes::TSNonNullExpression(e) => expression = e,
            // The chain ends here.
            AstNodes::NewExpression(e) if is(e.callee()) => {
                expression = e;
                parent = parent.parent();
                break;
            }
            AstNodes::TSAsExpression(e) | AstNodes::TSSatisfiesExpression(e) => {
                expression = e;
                parent = parent.parent();
                break;
            }
            _ => break,
        }
        parent = parent.parent();
    }
    if expression == conditional {
        return false;
    }

    match parent {
        AstNodes::VariableDeclarator(declarator) => declarator.init() == Some(expression),
        AstNodes::ReturnStatement(_) | AstNodes::ThrowStatement(_) => true,
        AstNodes::UnaryExpression(e)
        | AstNodes::YieldExpression(e)
        | AstNodes::AwaitExpression(e) => e.argument() == Some(expression),
        AstNodes::AssignmentExpression(assignment) => assignment.right() == Some(expression),
        _ => false,
    }
}

/// Where a conditional sits inside another one.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ConditionalLayout {
    /// It isn't inside another conditional.
    Root {
        /// One of its operands, or of the conditionals inside it, is a JSX element.
        jsx_chain: bool,
    },
    /// ```javascript
    /// (
    ///   a
    ///     ? b
    ///     : c
    /// )
    ///   ? d
    ///   : e;
    /// ```
    NestedTest {
        /// The same as for `Root`.
        jsx_chain: bool,
    },
    /// ```javascript
    /// a
    ///   ? b
    ///     ? c
    ///     : d
    ///   : e;
    /// ```
    NestedConsequent,
    /// The condition is aligned with what's after the parent's `:`.
    ///
    /// ```javascript
    /// a
    ///   ? b
    ///   : c +
    ///       d
    ///     ? e
    ///     : f;
    /// ```
    NestedAlternate,
}

impl ConditionalLayout {
    fn is_root(self) -> bool {
        matches!(self, Self::Root { .. })
    }

    fn is_nested_test(self) -> bool {
        matches!(self, Self::NestedTest { .. })
    }

    fn is_nested_alternate(self) -> bool {
        matches!(self, Self::NestedAlternate)
    }

    fn is_jsx_chain(self) -> bool {
        matches!(
            self,
            Self::Root { jsx_chain: true } | Self::NestedTest { jsx_chain: true }
        )
    }
}

/// The arrow function that `e` is. A type cast keeps parentheses around `e`: the rule leaves what they hold.
fn arrow_of<'a>(e: Expr<'a>, f: &Formatter<'a>) -> Option<Func<'a>> {
    match is_cast_target(e, f) {
        true => None,
        false => e.arrow_function(),
    }
}

/// The arrow function that `function` returns. oxfmt prints no parentheses of a type cast around that one.
fn returned_arrow<'a>(function: Func<'a>, f: &Formatter<'a>) -> Option<Func<'a>> {
    match function.body() {
        FnBody::Expr(body) if !is_cast_target_that_hides_its_kind(body, f) => body.arrow_function(),
        _ => None,
    }
}

/// What the chain of arrow functions that `e` starts returns, or `e`. `None` if the last one has a block.
fn end_of_chain<'a>(e: Expr<'a>, f: &Formatter<'a>) -> Option<Expr<'a>> {
    let (mut end, mut arrow) = (e, arrow_of(e, f));
    while let Some(function) = arrow {
        let FnBody::Expr(body) = function.body() else {
            return None;
        };
        (end, arrow) = (body, returned_arrow(function, f));
    }
    Some(end)
}

/// True if tsc reads `a ? b => ({ c }) : d => (e): T => f` of Prettier as `a ? b => (({ c }): d => (e)) : T => f`.
fn is_misread_by_tsc<'a>(before: Expr<'a>, after: Expr<'a>, f: &Formatter<'a>) -> bool {
    let Some(first) = arrow_of(after, f) else {
        return false;
    };
    // It tries `d` as the return type of `({ c })`, or a function type that ends with a name: `(a, b) => d`.
    let mut name = first;
    while !prettier_avoids_parentheses(name, f) {
        // No type has `async` or `(e): T` in it.
        if name.is_async() || name.return_type().is_some() {
            return false;
        }
        let Some(next) = returned_arrow(name, f) else {
            return false;
        };
        name = next;
    }
    // What follows `d =>` is the body, up to the `:` of `(e): T`. In it, tsc keeps `(e): T => f` only before a `:`.
    let Some(mut typed) = returned_arrow(name, f) else {
        return false;
    };
    while typed.return_type().is_none() {
        // After `()`, `(e: U)`, `(e?)` and `(...e)` it is sure of an arrow function, and keeps every `(e): T => f`.
        if has_sure_parameters(typed, f) {
            return false;
        }
        let Some(next) = returned_arrow(typed, f) else {
            return false;
        };
        typed = next;
    }
    !name.is_async()
        && !is_type_operator(name)
        && is_expression_too(typed, f)
        && typed.return_type().is_some_and(is_name_of_parameter)
        && can_end_with_parameters(before, f)
        && ends_with_parameters(before, f)
}

/// `keyof`, `unique`, `readonly` and `infer` start a type: for `keyof =>` as a return type, tsc reports a syntax error.
fn is_type_operator(name: Func<'_>) -> bool {
    let is_operator = |name: &[u8]| matches!(name, b"keyof" | b"unique" | b"readonly" | b"infer");
    (name.params().first()).is_some_and(
        |only| matches!(only.pat().kind(), PatKind::Ident(name) if is_operator(name.bytes())),
    )
}

/// True if tsc knows from the start of its `( .. )` that `function` is an arrow function, and tries no other reading.
fn has_sure_parameters<'a>(function: Func<'a>, f: &Formatter<'a>) -> bool {
    let path = f.filepath();
    // `<U,>(e)`, in a file that can have JSX.
    let has_jsx = !(path.ends_with(b".ts") || path.ends_with(b".mts") || path.ends_with(b".cts"));
    (has_jsx && !function.type_params().is_empty())
        || function.this_param().is_some()
        || function.params().first().is_none_or(|first| {
            let is_name = matches!(first.pat().kind(), PatKind::Ident(_));
            first.is_rest() || (is_name && (first.ty().is_some() || first.is_optional()))
        })
}

/// True if tsc can read the `(e)` of `(e): T => f` as an expression too: `(e, g)`, `(e = 1)`, `({ e })`, `<U>(e)`.
fn is_expression_too<'a>(typed: Func<'a>, f: &Formatter<'a>) -> bool {
    let mut type_parameters = typed.type_params().into_iter();
    // `<U>(e)` is a type assertion in a `.ts` file. In every other file, Prettier prints `<U,>(e)`.
    let is_assertion_too = match (type_parameters.next(), type_parameters.next()) {
        (None, _) => true,
        (Some(only), None) => {
            let is_plain =
                only.constraint().is_none() && only.default().is_none() && only.flags().is_empty();
            is_plain && f.filepath().ends_with(b".ts")
        }
        _ => false,
    };
    let mut patterns = smallvec::SmallVec::<[Pat<'a>; 4]>::new();
    for parameter in typed.params() {
        if parameter.ty().is_some() || parameter.is_rest() || parameter.is_optional() {
            return false;
        }
        patterns.push(parameter.pat());
    }
    while let Some(pattern) = patterns.pop() {
        match pattern.kind() {
            PatKind::Object(properties) => {
                for property in properties {
                    // `{ e = 1 }` is a pattern only.
                    if property.is_shorthand() && property.default().is_some() {
                        return false;
                    }
                    patterns.push(property.value());
                }
            }
            PatKind::Array(elements) => {
                patterns.extend(elements.into_iter().filter_map(|element| element.pat()))
            }
            PatKind::Ident(_) | PatKind::Missing => {}
        }
    }
    is_assertion_too && !has_sure_parameters(typed, f)
}

/// True if `T => f` is an arrow function, which tsc reads after `(e):`. `Promise<T>`, `void` and `enum` are no names.
fn is_name_of_parameter(return_type: TypeNode<'_>) -> bool {
    let is_reserved = |name: &[u8]| {
        bun_ast::lexer_tables::keyword(name).is_some() || matches!(name, b"await" | b"yield")
    };
    // Prettier prints `| T` as `T`.
    match without_lone_operator(return_type).kind() {
        TypeKind::Ref { name, args } => {
            args.is_empty()
                && name.len() == 1
                && name.first().is_some_and(|name| !is_reserved(name.bytes()))
        }
        TypeKind::Keyword(keyword) => {
            !matches!(keyword, Keyword::Void | Keyword::Null | Keyword::This)
        }
        _ => false,
    }
}

/// True if `operand`, which can end with `( .. )`, has names in them that tsc reads as parameters with no error.
fn ends_with_parameters<'a>(operand: Expr<'a>, f: &Formatter<'a>) -> bool {
    let Some(body) = end_of_chain(operand, f) else {
        return false;
    };
    // `(a, b)`, `(this, b)` and `(a = 1)`.
    let is_in_parentheses = |e: Expr<'_>| match e.kind() {
        ExprKind::Binary {
            op: BinOp::Comma, ..
        } => (e.sequence().into_iter())
            .all(|name| name.tag() == ExprTag::This || is_parameter_name(name, false)),
        ExprKind::Assign {
            op: None, target, ..
        } => is_parameter_name(target, true),
        _ => false,
    };
    // An operand under `// prettier-ignore` is printed as it is written: tsc tries `(a)` too, and not `((a, b))`.
    if body != operand && f.comments().is_ignored(operand.as_ast_nodes()) {
        let is_at_end = body.parens().len() == 1 && body.outer_span().end == operand.span().end;
        // `({ a: (b) })` has no parameter in it.
        let is_plain =
            !bun_core::strings::contains_char(f.source_text().text_for(&body.span()), b'(');
        return is_at_end
            && is_plain
            && (is_in_parentheses(body) || is_parameter_name(body, false));
    }
    match body.kind() {
        ExprKind::Object(_) => is_parameter_name(body, false),
        // Parentheses of a type cast around `async(a)` or `<U>(a, b)` are no parameters.
        ExprKind::Call(_) | ExprKind::As { .. } if is_cast_target(body, f) => false,
        // `async(a)`: tsc tries `async (a): d => (e)` as an arrow function. Prettier prints `async((a = 1))`.
        ExprKind::Call(call) => {
            let has_no_more = !call.is_optional() && call.type_args().is_empty();
            has_no_more
                && call
                    .args()
                    .into_iter()
                    .all(|name| is_parameter_name(name, false))
        }
        // `<U>(a, b)`: tsc tries `<U>(a, b): d => (e)` as one too.
        ExprKind::As { expr, ty } => {
            matches!(ty.kind(), TypeKind::Ref { name, args } if name.len() == 1 && args.is_empty())
                && is_in_parentheses(expr)
        }
        _ => is_in_parentheses(body),
    }
}

/// `a`, `{ a, b: c, ...d }`, `[a, , ...b]`: what tsc reads as a parameter's name. `{ a = 1 }` is one in a target only.
fn is_parameter_name(e: Expr<'_>, is_target: bool) -> bool {
    let mut pending = smallvec::SmallVec::<[Expr<'_>; 8]>::new();
    pending.push(e);
    while let Some(e) = pending.pop() {
        match e.kind() {
            ExprKind::Ident(_) | ExprKind::Missing => {}
            ExprKind::Object(properties) => {
                for property in properties {
                    match (property.kind(), property.value()) {
                        // In an object, tsc reads `...d` before a name only.
                        (PropKind::Spread, Some(rest)) if rest.tag() == ExprTag::Ident => {}
                        (PropKind::Init | PropKind::Shorthand, Some(value)) => pending.push(value),
                        _ => return false,
                    }
                }
            }
            ExprKind::Array(elements) => pending.extend(elements),
            ExprKind::Spread(rest) => pending.push(rest),
            // Anywhere else, Prettier prints the parentheses of `[(a = 1)]`.
            ExprKind::Assign {
                op: None, target, ..
            } if is_target => pending.push(target),
            _ => return false,
        }
    }
    true
}

/// True if a TypeScript parser reads the code: in JavaScript, only the parsers `typescript` and `babel-ts`.
fn is_read_by_typescript(f: &Formatter<'_>) -> bool {
    !f.file().is_javascript()
        || matches!(
            f.options().parser.as_deref(),
            Some(b"typescript" | b"babel-ts")
        )
}

/// True if Prettier prints `( .. )` around each operand of a conditional with an element in it: where lines can break.
fn has_parentheses_around_jsx_operands(f: &Formatter<'_>) -> bool {
    !f.options().experimental_ternaries && !f.context().removes_soft_lines.get()
}

/// True if `conditional` ends an operand of the conditional around it: what follows that operand follows it too.
fn ends_operand<'a>(conditional: Expr<'a>, f: &Formatter<'a>) -> bool {
    let mut end = conditional;
    loop {
        // As in `end_of_chain`: a type cast keeps parentheses around `end`, if it is no arrow function in a chain.
        let is_apart =
            |function: Func<'a>| returned_arrow(function, f).is_none() && is_cast_target(end, f);
        match end.parent() {
            Node::Expr(parent) => {
                let is_operand = matches!(parent.kind(), ExprKind::Cond { yes, no, .. } if yes == end || no == end);
                return is_operand && !is_cast_target(end, f);
            }
            // The body of an arrow function.
            Node::Func(function) => match (function.body(), function.owner()) {
                (FnBody::Expr(body), Node::Expr(arrow))
                    if body == end && function.is_arrow() && !is_apart(function) =>
                {
                    end = arrow
                }
                _ => return false,
            },
            _ => return false,
        }
    }
}

/// True if tsc misreads a conditional of the family of `root`: `root` and, in turn, the ones that end their operands.
fn is_family_misread<'a>(root: Expr<'a>, f: &Formatter<'a>) -> bool {
    let mut pending = smallvec::SmallVec::<[Expr<'a>; 8]>::new();
    pending.push(root);
    while let Some(conditional) = pending.pop() {
        let Some((_, before, after)) = conditional.as_cond() else {
            continue;
        };
        if is_misread_by_tsc(before, after, f) {
            return true;
        }
        for operand in [before, after] {
            let Some(end) = end_of_chain(operand, f) else {
                continue;
            };
            // An arrow function's conditional with an element in it has the parentheses around its own operands.
            let is_apart = end != operand
                && has_parentheses_around_jsx_operands(f)
                && is_jsx_conditional_chain(end);
            if end.tag() == ExprTag::Cond && !is_apart && !is_cast_target(end, f) {
                pending.push(end);
            }
        }
    }
    false
}

/// True if `operand` can be printed with `( .. )` at its end that tsc tries as parameters, through what a `:` ends.
fn can_end_with_parameters<'a>(operand: Expr<'a>, f: &Formatter<'a>) -> bool {
    let mut end = operand;
    // An object has parentheses only as the body of an arrow function.
    let mut is_body = false;
    // An operand under `// prettier-ignore` is printed as it is written.
    let is_written = f.comments().is_ignored(operand.as_ast_nodes());
    loop {
        // A type cast keeps `( .. )` around anything, and so does what is written.
        if is_cast_target(end, f) || (is_written && end != operand && end.is_parenthesized()) {
            return true;
        }
        (end, is_body) = match (
            end.arrow_function().map(|function| function.body()),
            end.kind(),
        ) {
            (Some(FnBody::Expr(body)), _) => (body, true),
            (Some(_), _) => return false,
            // Where a conditional before a `:` breaks, it has no parentheses.
            (None, ExprKind::Cond { no, .. }) => (no, false),
            // `yield (a, b)`
            (
                None,
                ExprKind::Yield {
                    value: Some(value), ..
                },
            ) => (value, false),
            _ => break,
        };
    }
    match end.kind() {
        ExprKind::Object(_) => is_body,
        ExprKind::Call(call) => {
            matches!(call.callee().kind(), ExprKind::Ident(name) if name.bytes() == b"async")
        }
        // Prettier prints `<U>(a, b)` and `<U>(a => b)`, and `<U>a` with no parentheses.
        ExprKind::As { expr, .. } => {
            end.is_angle_bracket_assertion() && expression_needs_parentheses(expr, f)
        }
        kind => matches!(
            kind,
            ExprKind::Assign { .. }
                | ExprKind::Binary {
                    op: BinOp::Comma,
                    ..
                }
        ),
    }
}

/// The arrow functions after the `:` of `conditional` that tsc can read as a function type: `(a, b) => d => e`.
fn heads_after_colon<'a>(conditional: Expr<'a>, f: &Formatter<'a>) -> Option<Span> {
    let (_, before, after) = conditional.as_cond()?;
    if !can_end_with_parameters(before, f) {
        return None;
    }
    let first = arrow_of(after, f)?;
    let mut head = first;
    // No type has `async` or `(e): T` in it: what follows them keeps `e =>`.
    while !head.is_async() && head.return_type().is_none() {
        match (returned_arrow(head, f), head.body()) {
            (Some(next), _) => head = next,
            (None, FnBody::Expr(body)) => {
                return Some(Span::new(first.span().start, body.span().start));
            }
            _ => return Some(Span::new(first.span().start, head.span().end)),
        }
    }
    Some(Span::new(first.span().start, head.span().start))
}

/// What a conditional decides about the arrow functions after its `:`, for the time that its operands are written.
#[derive(Clone, Copy, Default)]
pub(crate) struct AfterColon {
    /// The arrow functions that keep `(d) =>`.
    names: Option<Span>,
    /// True if tsc misreads a conditional of the family that is being written. `None` if no family is.
    is_misread: Option<bool>,
}

impl AfterColon {
    /// Puts what `conditional` decides in the context for the time that it is written. `leave` takes what this returns.
    #[inline]
    pub(super) fn enter<'a>(
        conditional: ConditionalLike<'a>,
        is_jsx_chain: bool,
        f: &Formatter<'a>,
    ) -> Option<Self> {
        match conditional {
            // Only `arrowParens: "avoid"` prints `d =>`.
            ConditionalLike::ConditionalExpression(e)
                if f.options().arrow_parentheses.is_as_needed() =>
            {
                let outer = f.context().after_colon.get();
                f.context()
                    .after_colon
                    .set(outer.within(e, is_jsx_chain, f));
                Some(outer)
            }
            _ => None,
        }
    }

    /// Puts back what was in the context before `enter`.
    #[inline]
    pub(super) fn leave(outer: Option<Self>, f: &Formatter<'_>) {
        if let Some(outer) = outer {
            f.context().after_colon.set(outer);
        }
    }

    /// What `conditional` decides, in the conditional that decided `self`.
    #[inline(never)]
    fn within<'a>(self, conditional: Expr<'a>, is_jsx_chain: bool, f: &Formatter<'a>) -> Self {
        if !is_read_by_typescript(f) || (is_jsx_chain && has_parentheses_around_jsx_operands(f)) {
            return Self::default();
        }
        // tsc can read `(a, b): y => ..` around a conditional that keeps `(d)`. So a family decides once, on `(y)` too.
        let is_misread = match self.is_misread {
            Some(is_misread) if ends_operand(conditional, f) => is_misread,
            _ => is_family_misread(conditional, f),
        };
        let names = if is_misread {
            heads_after_colon(conditional, f)
        } else {
            None
        };
        Self {
            names,
            is_misread: Some(is_misread),
        }
    }

    /// True if `arrow` keeps `(d) =>`. An arrow function in the default of a parameter ends before the names do.
    pub(crate) fn keeps_parentheses_of(self, arrow: Func<'_>) -> bool {
        (self.names).is_some_and(|names| {
            names.contains_offset(arrow.span().start) && arrow.span().end >= names.end
        })
    }
}

pub(crate) fn is_jsx_conditional_chain(e: Expr<'_>) -> bool {
    let mut pending = smallvec::SmallVec::<[Expr<'_>; 8]>::new();
    pending.push(e);
    while let Some(e) = pending.pop() {
        let ExprKind::Cond { test, yes, no } = e.kind() else {
            continue;
        };
        for operand in [test, yes, no] {
            match operand.tag() {
                ExprTag::Jsx => return true,
                ExprTag::Cond => pending.push(operand),
                _ => {}
            }
        }
    }
    false
}

impl<'a> FormatConditionalLike<'a> {
    fn layout(&self, f: &Formatter<'a>) -> ConditionalLayout {
        match (self.conditional, self.conditional.parent()) {
            // In Prettier a type cast's parentheses are a node, and that node is then the parent.
            (
                ConditionalLike::ConditionalExpression(e),
                AstNodes::ConditionalExpression(parent),
            ) if !is_cast_target_that_hides_its_kind(e, f) => match parent.kind() {
                ExprKind::Cond { test, .. } if test == e => ConditionalLayout::NestedTest {
                    jsx_chain: is_jsx_conditional_chain(e),
                },
                ExprKind::Cond { yes, .. } if yes == e => ConditionalLayout::NestedConsequent,
                _ => ConditionalLayout::NestedAlternate,
            },
            (ConditionalLike::TSConditionalType(ty), AstNodes::TSConditionalType(parent)) => {
                match parent.kind() {
                    TypeKind::Cond { check, extends, .. } if check == ty || extends == ty => {
                        ConditionalLayout::NestedTest { jsx_chain: false }
                    }
                    TypeKind::Cond { yes, .. } if yes == ty => ConditionalLayout::NestedConsequent,
                    _ => ConditionalLayout::NestedAlternate,
                }
            }
            (ConditionalLike::ConditionalExpression(e), _) => ConditionalLayout::Root {
                jsx_chain: is_jsx_conditional_chain(e),
            },
            _ => ConditionalLayout::Root { jsx_chain: false },
        }
    }

    fn is_parent_static_member_expression(
        &self,
        layout: ConditionalLayout,
        f: &Formatter<'a>,
    ) -> bool {
        layout.is_root()
            && matches!(self.conditional, ConditionalLike::ConditionalExpression(_))
            && match self.conditional.parent() {
                AstNodes::StaticMemberExpression(_) | AstNodes::PrivateFieldExpression(_) => true,
                // It's the left side.
                AstNodes::BinaryExpression(binary) => binary
                    .binary_op()
                    .is_some_and(|operator| is_angular_pipe(operator, f)),
                _ => false,
            }
    }

    fn format_test(&self, f: &mut Formatter<'a>, layout: ConditionalLayout) {
        let format_inner = format_with(|f| match self.conditional {
            ConditionalLike::ConditionalExpression(conditional) => {
                write!(f, conditional.test());
            }
            ConditionalLike::TSConditionalType(conditional) => {
                if let TypeKind::Cond { check, extends, .. } = conditional.kind() {
                    write!(f, [check, space(), "extends", space(), extends]);
                }
            }
        });
        match layout.is_nested_alternate() {
            true => write!(f, align(2, &format_inner)),
            false => write!(f, format_inner),
        }
    }

    fn format_consequent_and_alternate(&self, f: &mut Formatter<'a>) {
        let Some((consequent, alternate)) = self.conditional.consequent_and_alternate() else {
            return;
        };
        let is_space = f.options().indent_style.is_space();
        let format_branch = |branch: Operand<'a>| {
            format_with(move |f: &mut Formatter<'a>| match is_space {
                true => write!(f, align(2, &branch)),
                false => write!(f, indent(&branch)),
            })
        };
        // `a ? (b ? c : d) : e`
        let is_nested_consequent = consequent.is_conditional();
        let outer = AfterColon::enter(self.conditional, false, f);
        write!(
            f,
            [
                soft_line_break_or_space(),
                "?",
                space(),
                is_nested_consequent.then_some(if_group_fits_on_line(&"(")),
                format_branch(consequent),
                is_nested_consequent.then_some(if_group_fits_on_line(&")")),
                soft_line_break_or_space(),
                ":",
                space(),
                format_branch(alternate)
            ]
        );
        AfterColon::leave(outer, f);
    }
}

impl<'a> Format<'a> for ConditionalLike<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        if f.options().experimental_ternaries {
            return super::experimental_ternary::write_ternary(*self, f);
        }
        FormatConditionalLike {
            conditional: *self,
            jsx_chain: false,
        }
        .fmt(f);
    }
}

struct FormatConditionalLike<'a> {
    conditional: ConditionalLike<'a>,
    /// It's inside a conditional that's a JSX chain.
    jsx_chain: bool,
}

impl<'a> Format<'a> for FormatConditionalLike<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let layout = self.layout(f);
        let should_extra_indent = layout.is_root()
            && matches!(self.conditional, ConditionalLike::ConditionalExpression(e) if should_extra_indent(e));
        let is_jsx_chain = self.jsx_chain || layout.is_jsx_chain();

        let format_inner = format_with(|f| {
            self.format_test(f, layout);

            let tail = format_with(|f| self.format_consequent_and_alternate(f));
            if is_jsx_chain
                && let ConditionalLike::ConditionalExpression(conditional) = self.conditional
                && let ExprKind::Cond { yes, no, .. } = conditional.kind()
            {
                let outer = AfterColon::enter(self.conditional, true, f);
                write!(
                    f,
                    [
                        space(),
                        "?",
                        space(),
                        FormatJsxChainExpression {
                            expression: yes,
                            is_alternate: false
                        },
                        space(),
                        ":",
                        space(),
                        FormatJsxChainExpression {
                            expression: no,
                            is_alternate: true
                        }
                    ]
                );
                AfterColon::leave(outer, f);
            } else {
                match layout {
                    ConditionalLayout::Root { .. } | ConditionalLayout::NestedTest { .. } => {
                        write!(f, indent(&tail))
                    }
                    // The `dedent` undoes the parent's `align`, which with tabs would become an extra indentation
                    // level.
                    ConditionalLayout::NestedConsequent => write!(f, dedent(&indent(&tail))),
                    ConditionalLayout::NestedAlternate => write!(f, tail),
                }
            }

            // ```text
            // (a
            //   ? b
            //   : c
            // ).d
            // ```
            if !should_extra_indent
                && !is_jsx_chain
                && self.is_parent_static_member_expression(layout, f)
            {
                write!(f, soft_line_break());
            }
        });

        let grouped = format_with(|f| match layout.is_root() || layout.is_nested_test() {
            true => write!(f, group(&format_inner)),
            false => write!(f, format_inner),
        });

        match layout.is_nested_test() || should_extra_indent {
            true => write!(f, group(&soft_block_indent(&grouped))),
            false => write!(f, grouped),
        }
    }
}

/// An operand of a conditional that has a JSX element in it. If the conditional breaks, the operand is wrapped in
/// parentheses, unless it's `null`, `undefined` or a conditional after the `:`.
///
/// ```javascript
/// a ? (
///   <b>
///     <c />
///   </b>
/// ) : (
///   <d>
///     <e />
///   </d>
/// );
/// ```
struct FormatJsxChainExpression<'a> {
    expression: Expr<'a>,
    /// It's the operand after the `:`.
    is_alternate: bool,
}

impl<'a> Format<'a> for FormatJsxChainExpression<'a> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        // A conditional expression in here isn't printed through `Expr`, so the stack check has to happen here.
        if !f.context_mut().has_stack_left() {
            return;
        }
        let expression = self.expression;
        let is_conditional = matches!(expression.kind(), ExprKind::Cond { .. })
            && !is_cast_target_that_hides_its_kind(expression, f);
        let no_wrap = match expression.kind() {
            ExprKind::Ident(name) => name.bytes() == b"undefined",
            ExprKind::Null => true,
            _ => is_conditional && self.is_alternate,
        };

        let format_expression = format_with(|f| match is_conditional {
            true => format_node(expression.as_ast_nodes(), f, |f| {
                FormatConditionalLike {
                    conditional: ConditionalLike::ConditionalExpression(expression),
                    jsx_chain: true,
                }
                .fmt(f);
            }),
            false => expression.fmt(f),
        });

        if no_wrap {
            write!(f, format_expression);
        } else {
            write!(
                f,
                [
                    if_group_breaks(&"("),
                    soft_block_indent(&format_expression),
                    if_group_breaks(&")")
                ]
            );
        }
    }
}
