//! `a ? b : c` and `A extends B ? C : D`. Prettier's `printTernary`.

use super::experimental_ternary::parenthesizes_alternate;
use super::typecast::{is_cast_target, is_cast_target_that_hides_its_kind};
use super::typescript::without_lone_operator;
use crate::js::format::format_node;
use crate::js::parentheses::expression::expression_needs_parentheses;
use crate::js::print::arrow_function_expression::has_complex_signature;
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

/// tsc's reading of `( .. ): d => ..` before the `:` of a conditional, where `d =>` follows that `:`, up to a point.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Trial {
    /// It tries no such reading there.
    None,
    /// It reads a body after `d =>`, which has to end before a `:`. `true` after a chain that Prettier breaks.
    Open(bool),
    /// It keeps the reading: `a ? b => ({ c }) : d => (e): T => f` is `a ? b => (({ c }): d => (e)) : T => f` then.
    Kept,
}

/// How tsc goes on from `trial` after the `:` between `before` and `after`. `goes_on`: a conditional ends `after`.
fn read_by_tsc<'a>(
    before: Expr<'a>,
    after: Expr<'a>,
    mut trial: Trial,
    goes_on: bool,
    f: &Formatter<'a>,
) -> Trial {
    let has_parameters = || can_end_with_parameters(before, f) && ends_with_parameters(before, f);
    // Where Prettier breaks a chain of arrow functions, a conditional that ends it has no parentheses.
    let is_after_break = trial == Trial::Open(true);
    // It tries `d` as the return type of `({ c })`, or a function type that ends with a name: `(a, b) => d`.
    let (mut is_type, mut has_name) = (true, false);
    let (mut arrow, mut is_returned) = (arrow_of(after, f), false);
    while let Some(function) = arrow {
        if has_sure_parameters(function, f) {
            // After `()`, `(e: U)`, `(e?)` and `(...e)` it is sure of an arrow function, and keeps every `(e): T => f`.
            (trial, has_name) = (Trial::None, false);
        } else if let Some(return_type) = function.return_type() {
            // Prettier breaks a chain of arrow functions with `(e): T` in it, and a conditional around that chain.
            let is_in_chain = is_returned || returned_arrow(function, f).is_some();
            // In the body, tsc keeps `(e): T => f` only before a `:`. One that it gives up ends the body at `(e)`.
            if (is_in_chain || is_after_break)
                && is_expression_too(function, f)
                && is_one_name(return_type)
            {
                if trial != Trial::None || (has_name && has_parameters()) {
                    return Trial::Kept;
                }
                has_name = false;
            }
        }
        let is_name = prettier_avoids_parentheses(function, f);
        if is_type && is_name {
            has_name = !function.is_async() && !is_type_operator(function);
        }
        // No type has `async` or `(e): T` in it.
        is_type = is_type && !is_name && !function.is_async() && function.return_type().is_none();
        if trial == Trial::None && !is_type && !has_name {
            return Trial::None;
        }
        (arrow, is_returned) = (returned_arrow(function, f), true);
    }
    // The body goes on after the `:` of the conditional that ends it.
    if !goes_on || (trial == Trial::None && !(has_name && has_parameters())) {
        return Trial::None;
    }
    let breaks = if arrow_of(after, f).is_none() {
        is_after_break
    } else {
        breaks_chain(after, f)
    };
    // Where the lines cannot break, that conditional has parentheses, if it ends no chain that Prettier breaks.
    match breaks || !f.context().removes_soft_lines.get() {
        true => Trial::Open(breaks),
        false => Trial::None,
    }
}

/// True if Prettier breaks the chain of arrow functions that `e` starts: a pattern, a type or `(e): T` is in it.
fn breaks_chain<'a>(e: Expr<'a>, f: &Formatter<'a>) -> bool {
    let (mut arrow, mut count, mut is_complex) = (arrow_of(e, f), 0, false);
    while let Some(function) = arrow {
        (count, is_complex) = (count + 1, is_complex || has_complex_signature(function));
        arrow = returned_arrow(function, f);
    }
    count > 1 && is_complex
}

/// True if tsc reads `<U>` at the start of an expression as an element: in every file but `.ts`, `.mts` and `.cts`.
fn can_have_jsx(f: &Formatter<'_>) -> bool {
    let path = f.filepath();
    !(path.ends_with(b".ts") || path.ends_with(b".mts") || path.ends_with(b".cts"))
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
    // `<U,>(e)`, in a file that can have JSX.
    if !function.type_params().is_empty() && can_have_jsx(f) {
        return true;
    }
    match function.this_param() {
        // `(this: U)`. It tries both readings of `(this)` and `(this, e)`.
        Some(this) => this.ty().is_some(),
        None => function.params().first().is_none_or(|first| {
            let is_name = matches!(first.pat().kind(), PatKind::Ident(_));
            first.is_rest() || (is_name && (first.ty().is_some() || first.is_optional()))
        }),
    }
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
    // Its parser reads `({ e = 1 })` as an expression too, with no error.
    let mut parameters = typed.params().into_iter();
    is_assertion_too
        && parameters.all(|parameter| {
            parameter.ty().is_none() && !parameter.is_rest() && !parameter.is_optional()
        })
}

/// True if tsc reads `ty` as a name too: of the parameter in `T => f`, of the type parameter in `<T>(a) => f`.
fn is_one_name(ty: TypeNode<'_>) -> bool {
    // `Promise<T>`, `void` and `enum` are no names.
    let is_reserved = |name: &[u8]| bun_ast::lexer_tables::keyword(name).is_some();
    // Prettier prints `| T` as `T`.
    match without_lone_operator(ty).kind() {
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
    // An operand under `// prettier-ignore` is printed as it is written, with the parentheses that it has there.
    let is_written = f.comments().is_ignored(operand.as_ast_nodes());
    // The parentheses around the operand itself are the printer's.
    let has_own_parentheses = |e: Expr<'a>| is_written && e != operand && e.is_parenthesized();
    let mut end = operand;
    let body = loop {
        let Some(body) = end_of_chain(end, f) else {
            return false;
        };
        // Where a conditional breaks, one before its `:` has no parentheses. One that an arrow function returns can.
        let is_cond_apart =
            body != end || is_cast_target(body, f) || f.context().removes_soft_lines.get();
        end = match body.kind() {
            _ if has_own_parentheses(body) => break body,
            // After `yield`, tsc tries `( .. )` as parameters in the same way.
            ExprKind::Yield {
                value: Some(value), ..
            } => value,
            ExprKind::Cond { no, .. } if !is_cond_apart => no,
            _ => break body,
        };
    };
    // What an arrow function returns can be under `// prettier-ignore` too: what is in it is as it is written then.
    let is_written_within = is_written || f.comments().is_ignored(body.as_ast_nodes());
    // As it is written, a name in parentheses of its own is no parameter: `(a, (b))`.
    let is_bare = |name: Expr<'a>| !(is_written_within && name.is_parenthesized());
    // `(a)`, `(this)` and `([a, b])`: only a type cast and what is written have these parentheses.
    let is_alone =
        |e: Expr<'a>| e.tag() == ExprTag::This || is_parameter_name(e, false, is_written_within);
    // `(a, b)`, `(this, b)` and `(a = 1)`.
    let is_in_parentheses = |e: Expr<'a>| match e.kind() {
        ExprKind::Binary {
            op: BinOp::Comma, ..
        } => (e.sequence().into_iter()).all(|name| is_bare(name) && is_alone(name)),
        ExprKind::Assign {
            op: None, target, ..
        } => is_bare(target) && is_parameter_name(target, true, is_written_within),
        _ => false,
    };
    if has_own_parentheses(body) {
        // tsc tries `(a)` too, and not `((a, b))`.
        let is_at_end = body.parens().len() == 1 && body.outer_span().end == operand.span().end;
        return is_at_end && (is_in_parentheses(body) || is_alone(body));
    }
    match body.kind() {
        // Parentheses of a type cast around `async(a)` or `<U>(a, b)` are no parameters.
        ExprKind::Call(_) | ExprKind::As { .. } if is_cast_target(body, f) => false,
        // `async(a)`: tsc tries `async (a): d => (e)` as an arrow function. Prettier prints `async((a = 1))`.
        ExprKind::Call(call) => {
            // `async<U>(a)` too, where `<U>` starts no element.
            let has_type_parameters =
                !can_have_jsx(f) && call.type_args().into_iter().all(is_one_name);
            let has_no_more = call.type_args().is_empty() || has_type_parameters;
            has_no_more && (call.args().into_iter()).all(|name| is_bare(name) && is_alone(name))
        }
        // `<U>(a, b)`: tsc tries `<U>(a, b): d => (e)` as one too. As it is written, `<U>(a)` has its parentheses.
        ExprKind::As { expr, ty } => {
            let is_in_pair = match is_written_within {
                true => expr.parens().len() == 1 && (is_in_parentheses(expr) || is_alone(expr)),
                false => is_in_parentheses(expr),
            };
            is_one_name(ty) && is_in_pair
        }
        // As it is written, nothing else ends with `)`.
        _ if is_written && body != operand => false,
        ExprKind::Object(_) => is_parameter_name(body, false, is_written_within),
        _ => is_in_parentheses(body) || (is_cast_target(body, f) && is_alone(body)),
    }
}

/// `a`, `{ a, b: c, ...d }`, `[a, , ...b]`: what tsc reads as a parameter's name. `{ a = 1 }` is one in a target only.
fn is_parameter_name(e: Expr<'_>, is_target: bool, is_written: bool) -> bool {
    let mut pending = smallvec::SmallVec::<[Expr<'_>; 8]>::new();
    pending.push(e);
    while let Some(name) = pending.pop() {
        // As it is written, a name in parentheses of its own is none: `{ a: (b) }`.
        if is_written && name != e && name.is_parenthesized() {
            return false;
        }
        match name.kind() {
            ExprKind::Ident(_) | ExprKind::Missing => {}
            ExprKind::Object(properties) => {
                for property in properties {
                    match (property.kind(), property.value()) {
                        // In an object, tsc reads `...d` before a name only.
                        (PropKind::Spread, Some(rest)) if rest.tag() == ExprTag::Ident => {
                            pending.push(rest)
                        }
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
            } if is_target || is_written => pending.push(target),
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
    // True if `end`, a conditional that ends `operand`, has parentheses of its own.
    let is_apart = |operand: Expr<'a>, end: Expr<'a>| {
        // An arrow function's conditional with an element in it has the parentheses around its own operands.
        let is_jsx = end != operand
            && has_parentheses_around_jsx_operands(f)
            && is_jsx_conditional_chain(end);
        is_jsx || is_cast_target(end, f)
    };
    // With `--experimental-ternaries`, Prettier prints `a ? b : (⏎c⏎)` for a short `b`: a body ends at that `)`.
    let goes_on =
        |end: Expr<'a>| !(f.options().experimental_ternaries && parenthesizes_alternate(end, f));
    let mut pending = smallvec::SmallVec::<[(Expr<'a>, Trial); 8]>::new();
    pending.push((root, Trial::None));
    while let Some((conditional, trial)) = pending.pop() {
        let Some((_, before, after)) = conditional.as_cond() else {
            continue;
        };
        let end = end_of_chain(after, f);
        let next = end.filter(|&end| end.tag() == ExprTag::Cond && !is_apart(after, end));
        // tsc reads no name where no arrow function follows the `:`.
        let trial = match trial == Trial::None && end == Some(after) {
            true => Trial::None,
            false => read_by_tsc(before, after, trial, next.is_some_and(goes_on), f),
        };
        if trial == Trial::Kept {
            return true;
        }
        if let Some(next) = next {
            pending.push((next, trial));
        }
        let end = end_of_chain(before, f);
        if let Some(next) = end.filter(|&end| end.tag() == ExprTag::Cond && !is_apart(before, end))
        {
            pending.push((next, Trial::None));
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
        // `async(a)` and `async<U>(a)`. tsc tries no arrow function for `async?.(a)`.
        ExprKind::Call(call) => {
            !call.is_optional()
                && matches!(call.callee().kind(), ExprKind::Ident(name) if name.bytes() == b"async")
        }
        // Prettier prints `<U>(a, b)` and `<U>(a => b)`, and `<U>a` with no parentheses.
        ExprKind::As { expr, .. } => {
            let is_written = is_written || f.comments().is_ignored(end.as_ast_nodes());
            let has_parentheses = if is_written {
                expr.is_parenthesized()
            } else {
                expression_needs_parentheses(expr, f)
            };
            end.is_angle_bracket_assertion() && has_parentheses
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
