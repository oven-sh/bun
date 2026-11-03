//! Expressions.

use super::*;
use crate::css::embed::may_be_in_another_language;
use crate::js::parentheses::expression::is_name_that_may_need_parentheses;
use crate::js::print::arrow_function_expression::GroupedCallArgumentLayout;
use crate::js::print::call_like_expression::arguments::{
    ArgumentsLayout, arguments_layout, hugged_function_keeps_parameters_on_one_line,
};
use crate::js::utils::object::{printed_key, should_preserve_quote};

/// `a`, `this`, `a.b.c`
fn is_path_of_names(mut e: Expr<'_>) -> bool {
    while e.tag() == ExprTag::Dot && !e.is_chain_root() {
        match e.object() {
            Some(object) => e = object,
            None => return false,
        }
    }
    matches!(e.tag(), ExprTag::Ident | ExprTag::This)
}

/// `await (await a).b`: the parentheses of the inner one have no group of their own, so they can break whether they fit
/// or not.
fn starts_with_await(mut argument: Expr<'_>) -> bool {
    loop {
        let (left, is_object_or_callee) = match argument.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => (obj, true),
            ExprKind::Call(call) => (call.callee(), true),
            ExprKind::TaggedTemplate(call) => (call.callee(), false),
            ExprKind::Binary { left, .. } => (left, false),
            ExprKind::Assign { target, .. } => (target, false),
            ExprKind::Cond { test, .. } => (test, false),
            ExprKind::Unary { op, operand } if op.is_update() && !op.is_prefix() => {
                (operand, false)
            }
            ExprKind::NonNull(inner)
            | ExprKind::AsConst(inner)
            | ExprKind::As { expr: inner, .. }
            | ExprKind::Satisfies { expr: inner, .. } => (inner, false),
            _ => return false,
        };
        if is_object_or_callee && left.tag() == ExprTag::Await {
            return true;
        }
        argument = left;
    }
}

/// What [`Line::check_member_chain`] finds.
pub(super) enum ChainShape {
    /// The chain is on one line if that fits.
    OneLine {
        /// A line break that's forced in its last call doesn't break the chain.
        can_end_line: bool,
    },
    /// It depends on the groups of the chain.
    Groups,
}

/// True if there are several functions among `args`, or one in the arguments of an argument.
fn is_composition<'a>(args: List<'a, Expr<'a>>) -> bool {
    let mut functions = 0;
    for argument in args {
        match argument.tag() {
            ExprTag::Fn => functions += 1,
            ExprTag::Call | ExprTag::NonNull => {
                let mut inner = argument;
                while let (ExprTag::NonNull, Some(operand)) = (inner.tag(), inner.operand()) {
                    inner = operand;
                }
                if inner
                    .as_call()
                    .is_some_and(|call| call.args().iter().any(|it| it.tag() == ExprTag::Fn))
                {
                    return true;
                }
            }
            _ => {}
        }
    }
    functions > 1
}

/// A function with statements in it that's the first of two or three arguments, or the second of three.
fn function_before_last_argument<'a>(args: List<'a, Expr<'a>>) -> Option<Expr<'a>> {
    if !matches!(args.len(), 2 | 3) {
        return None;
    }
    args.iter().take(args.len() - 1).find(|argument| {
        (argument.as_fn().and_then(Func::body_statements))
            .is_some_and(|statements| !is_empty_block(statements))
    })
}

/// True if nothing before `e` on its line can break: it's a statement, or what a statement awaits or returns.
fn starts_statement(mut e: Expr<'_>) -> bool {
    loop {
        match e.parent() {
            Node::Stmt(statement) => {
                return matches!(statement.tag(), StmtTag::Expr | StmtTag::Return);
            }
            Node::Expr(parent) if parent.tag() == ExprTag::Await => e = parent,
            _ => return false,
        }
    }
}

/// True if nothing can break in the call of a function of a test framework: `it("name", (done) => {`,
/// `it("name", fakeAsync(() => {`, `beforeEach(waitForAsync(() => {`.
fn is_unbreakable_test_call(call: Call<'_>) -> bool {
    let callee = call.callee();
    let is_name = match callee.tag() {
        ExprTag::Ident => true,
        ExprTag::Dot => {
            !callee.is_chain_root() && callee.object().is_some_and(|it| it.tag() == ExprTag::Ident)
        }
        _ => false,
    };
    let args = call.args();
    let callback = match (args.len(), args.first(), args.last()) {
        (2, Some(first), Some(last)) if first.tag() == ExprTag::String => last,
        (1, _, Some(only)) if only.tag() == ExprTag::Call => only,
        _ => return false,
    };
    let is_plain = |function: Func<'_>| {
        matches!(function.body(), FnBody::Block(_))
            && function.return_type().is_none()
            && function.type_params().is_empty()
            && function.this_param().is_none()
            && function.params().iter().all(|param| {
                param.pat().tag() == PatTag::Ident
                    && param.ty().is_none()
                    && param.default().is_none()
                    && !param.is_rest()
                    && !param.is_optional()
                    && param.modifiers().is_empty()
            })
    };
    is_name
        && match callback.kind() {
            ExprKind::Fn(function) => is_plain(function),
            // The parameters of its function can break.
            ExprKind::Call(wrapper) => {
                wrapper.callee().tag() == ExprTag::Ident
                    && !wrapper.is_optional()
                    && wrapper.type_args().is_empty()
                    && wrapper.args().len() == 1
                    && (wrapper.args().first().and_then(Expr::as_fn))
                        .is_some_and(|function| function.params().is_empty() && is_plain(function))
            }
            _ => false,
        }
}

impl<'a> Line<'_, 'a> {
    /// The right side of `=` or `:`.
    pub(super) fn assigned(&mut self, value: Expr<'a>) -> Written {
        // `a = b = c` has a layout of its own.
        if value.tag() == ExprTag::Assign {
            return Err(Refused);
        }
        self.expr(value, Place::Free)
    }

    /// The right side of `=` or `:`, with nothing but closing brackets after it.
    pub(super) fn last_assigned(&mut self, value: Expr<'a>) -> Written {
        match value.tag() {
            ExprTag::Assign => Err(Refused),
            _ if self.breaks && !self.is_certain => Err(Refused),
            _ if self.breaks => self.assigned_too_wide(value),
            _ => self.last_expr(value, Place::Free),
        }
    }

    /// An expression with nothing but closing brackets after it, so that it can end the line.
    pub(super) fn last_expr(&mut self, e: Expr<'a>, place: Place) -> Written {
        let tag = e.tag();
        if self.breaks && !self.is_certain {
            return Err(Refused);
        }
        if self.breaks && is_unbreakable(tag) {
            return self.unbreakable(e, place);
        }
        let before_suffix = self.before_suffix(e);
        if !(matches!(
            tag,
            ExprTag::Fn
                | ExprTag::Object
                | ExprTag::Array
                | ExprTag::Call
                | ExprTag::New
                | ExprTag::Await
                | ExprTag::Assign
                | ExprTag::Jsx
        ) || (matches!(tag, ExprTag::Binary | ExprTag::Cond) && self.breaks)
            || before_suffix.is_some())
            || ((place != Place::Free || tag == ExprTag::Assign) && needs_parentheses(e, self.f))
            || (tag == ExprTag::Call
                && place != Place::Free
                && e.is_chain_root()
                && chain_expression_needs_parentheses(e, self.f))
        {
            return self.expr(e, place);
        }
        self.nested(|line| match tag {
            ExprTag::Fn => line.function(e.as_fn().ok_or(Refused)?, true),
            ExprTag::Object => line.object(e, true),
            ExprTag::Array => line.array(e, true),
            ExprTag::Call => line.call(e, true),
            ExprTag::New => line.new_expression(e, true),
            ExprTag::Await => {
                let argument = e.operand().ok_or(Refused)?;
                if starts_with_await(argument) {
                    return Err(Refused);
                }
                line.token("await ")?;
                line.last_expr(argument, Place::Other)
            }
            ExprTag::Jsx => line.jsx(e, true),
            ExprTag::Binary => line.binary_too_wide(e),
            ExprTag::Cond => line.conditional_too_wide(e),
            ExprTag::Assign => line.assignment(e, true),
            _ => line.with_suffix(e, before_suffix.ok_or(Refused)?),
        })
    }

    pub(super) fn new_expression(&mut self, e: Expr<'a>, is_last: bool) -> Written {
        let call = e.as_new().ok_or(Refused)?;
        self.check_flow_new(e, call.callee())?;
        self.token("new ")?;
        self.expr(call.callee(), Place::Other)?;
        self.type_arguments(call.type_args())?;
        self.arguments(e, call.args(), is_last, is_path_of_names(call.callee()))
    }

    pub(super) fn call(&mut self, e: Expr<'a>, is_last: bool) -> Written {
        let call = e.as_call().ok_or(Refused)?;
        let callee = call.callee();
        let mut is_plain_callee = true;
        let breaks = self.breaks && is_last;
        let is_member_chain = matches!(callee.tag(), ExprTag::Dot | ExprTag::Index);
        let mut is_callee_written = false;
        if is_member_chain {
            if !breaks
                && callee.tag() == ExprTag::Dot
                && let Some(written) = self.path_of_names(callee)
            {
                written?;
                is_callee_written = true;
            } else if !breaks {
                match self.check_member_chain(e)? {
                    ChainShape::OneLine { can_end_line } => is_plain_callee = can_end_line,
                    ChainShape::Groups if is_last => return self.member_chain(e),
                    ChainShape::Groups => return Err(Refused),
                }
            }
        } else if callee.tag() == ExprTag::Ident {
            // `graphql(schema, `..`)` has another language in it.
            if callee.span().len() == 7 && self.text_of(callee.span()) == b"graphql" {
                return Err(Refused);
            }
        } else {
            is_plain_callee = false;
        }
        // The arguments of a test, of `require` and the like stay on one line however long they are.
        if breaks && keeps_arguments_on_one_line(e, call, self.f) {
            if !is_unbreakable_test_call(call) {
                return Err(Refused);
            }
            self.keep_on_one_line(e);
        } else if breaks && is_member_chain {
            return self.member_chain(e);
        }
        if !is_callee_written {
            self.expr(callee, Place::Object)?;
        }
        if call.is_optional() {
            self.token("?.")?;
        }
        self.type_arguments(call.type_args())?;
        self.arguments(e, call.args(), is_last && is_plain_callee, is_plain_callee)
    }

    pub(super) fn assignment(&mut self, e: Expr<'a>, is_last: bool) -> Written {
        let (op, target, value) = e.as_assign().ok_or(Refused)?;
        // `a?.b = c` isn't valid, and has a layout of its own.
        if matches!(target.tag(), ExprTag::Object | ExprTag::Array)
            || !matches!(e.as_chain_element(), AstNodes::AssignmentExpression(_))
            || strings::index_of(self.text_of(target.span()), b"?.").is_some()
        {
            return Err(Refused);
        }
        self.expr(target, Place::Other)?;
        self.byte(b' ')?;
        self.token(assign_op_text(op))?;
        self.byte(b' ')?;
        match is_last {
            true => self.last_assigned(value),
            false => self.assigned(value),
        }
    }

    pub(super) fn expr(&mut self, e: Expr<'a>, place: Place) -> Written {
        if let Some(written) = self.plain_expr(e, place) {
            return written;
        }
        let tag = e.tag();
        match tag {
            ExprTag::Ident => {
                let span = e.span();
                // `let`, `async`, `await` and the like can need parentheses.
                if place != Place::Free
                    && (3..=9).contains(&span.len())
                    && needs_parentheses(e, self.f)
                {
                    return Err(Refused);
                }
                return self.source(span);
            }
            ExprTag::This => return self.token("this"),
            ExprTag::Null => return self.token("null"),
            ExprTag::True => return self.token("true"),
            ExprTag::False => return self.token("false"),
            ExprTag::Super => return self.token("super"),
            ExprTag::String => return self.string(e.span()),
            _ => {}
        }
        if tag == ExprTag::Dot
            && let Some(written) = self.path_of_names(e)
        {
            return written;
        }
        let is_link = matches!(
            tag,
            ExprTag::Dot | ExprTag::Index | ExprTag::Call | ExprTag::NonNull
        );
        let has_parentheses = match place {
            // `in` has them anywhere in the head of a `for` statement.
            Place::Free => {
                (tag == ExprTag::Assign
                    || (tag == ExprTag::Binary && e.binary_op() == Some(BinOp::In)))
                    && needs_parentheses(e, self.f)
            }
            Place::Object if is_link => {
                if e.is_chain_root() {
                    return Err(Refused);
                }
                false
            }
            _ => {
                let has_parentheses = needs_parentheses(e, self.f);
                if is_link
                    && e.is_chain_root()
                    && (has_parentheses || chain_expression_needs_parentheses(e, self.f))
                {
                    return Err(Refused);
                }
                has_parentheses
            }
        };
        if has_parentheses {
            self.byte(b'(')?;
        }
        self.nested(|line| line.expr_of(tag, e))?;
        if has_parentheses {
            self.byte(b')')?;
        }
        Ok(())
    }

    /// Copies the member access `e` if its source is nothing but names with a `.` between them: `a.b.c`, `this.a`. That
    /// needs no parentheses anywhere.
    #[inline]
    fn path_of_names(&mut self, e: Expr<'a>) -> Option<Written> {
        let span = e.span();
        let text = self.text_of(span);
        let mut first_name = 0;
        for (index, byte) in text.iter().enumerate() {
            match byte {
                b'a'..=b'z' | b'A'..=b'Z' | b'_' | b'$' | b'0'..=b'9' => {}
                b'.' if first_name == 0 => first_name = index,
                b'.' => {}
                _ => return None,
            }
        }
        let first_name = text.get(..first_name)?;
        // `.5.a` and `1.5.a` start with a number.
        if first_name
            .first()
            .is_none_or(|it| it.is_ascii_digit() || *it == b'.')
            || is_name_that_may_need_parentheses(first_name)
        {
            return None;
        }
        Some(self.source(span))
    }

    /// `e`, whose tag is `tag`, without parentheses.
    pub(super) fn expr_of(&mut self, tag: ExprTag, e: Expr<'a>) -> Written {
        match tag {
            ExprTag::Dot => {
                let (obj, name, chain) = e.as_dot().ok_or(Refused)?;
                self.expr(obj, Place::Object)?;
                self.token(match chain {
                    Chain::Start => "?.",
                    _ => ".",
                })?;
                self.source(name.span())
            }
            ExprTag::Call => self.call(e, false),
            ExprTag::Number => {
                let printed = format_trimmed_number(self.text_of(e.span()));
                self.long_bytes(&printed)
            }
            ExprTag::Index => {
                let (obj, index, chain) = e.as_index().ok_or(Refused)?;
                self.expr(obj, Place::Object)?;
                self.token(match chain {
                    Chain::Start => "?.[",
                    _ => "[",
                })?;
                self.expr(index, Place::Free)?;
                self.byte(b']')
            }
            ExprTag::New => self.new_expression(e, false),
            ExprTag::Unary => {
                let (op, operand) = e.as_unary().ok_or(Refused)?;
                if op.is_update() && !op.is_prefix() {
                    self.expr(operand, Place::Other)?;
                    return self.token(op.as_str());
                }
                self.token(op.as_str())?;
                if op.is_keyword() {
                    self.byte(b' ')?;
                }
                self.expr(operand, Place::Other)
            }
            ExprTag::Binary => {
                let (op, left, right) = e.as_binary().ok_or(Refused)?;
                // `a && (b && c)` loses its parentheses.
                if op == BinOp::Comma || right.binary_op() == Some(op) {
                    return Err(Refused);
                }
                match left.binary_op() {
                    // One chain, without the parentheses that `(a | b) | c` would get otherwise.
                    Some(left_op) if left_op != BinOp::Comma && should_flatten(op, left_op) => {
                        self.nested(|line| line.expr_of(ExprTag::Binary, left))?
                    }
                    _ => self.expr(left, Place::Other)?,
                }
                self.byte(b' ')?;
                self.token(bin_op_text(op))?;
                self.byte(b' ')?;
                self.expr(right, Place::Other)
            }
            ExprTag::Assign => self.assignment(e, false),
            ExprTag::Cond => {
                let (test, yes, no) = e.as_cond().ok_or(Refused)?;
                self.expr(test, Place::Other)?;
                self.token(" ? ")?;
                match yes.tag() {
                    ExprTag::Cond => {
                        self.byte(b'(')?;
                        self.expr(yes, Place::Other)?;
                        self.byte(b')')?;
                    }
                    _ => self.expr(yes, Place::Other)?,
                }
                self.token(" : ")?;
                self.expr(no, Place::Other)
            }
            ExprTag::Array => self.array(e, false),
            ExprTag::Object => self.object(e, false),
            ExprTag::Fn => self.function(e.as_fn().ok_or(Refused)?, false),
            ExprTag::Template => self.template(e),
            _ => self.less_common_expr(e),
        }
    }

    #[inline(never)]
    pub(super) fn less_common_expr(&mut self, e: Expr<'a>) -> Written {
        match e.kind() {
            ExprKind::Spread(argument) => {
                if e.jsx_container_span().is_some() {
                    return Err(Refused);
                }
                self.token("...")?;
                self.expr(argument, Place::Other)
            }
            ExprKind::Await(argument) => {
                if starts_with_await(argument) {
                    return Err(Refused);
                }
                self.token("await ")?;
                self.expr(argument, Place::Other)
            }
            ExprKind::As { expr, ty } | ExprKind::Satisfies { expr, ty } => {
                if e.is_angle_bracket_assertion() {
                    return match self.is_flow {
                        true => self.flow_type_cast(expr, ty),
                        false => Err(Refused),
                    };
                }
                self.expr(expr, Place::Other)?;
                self.token(match e.tag() {
                    ExprTag::Satisfies => " satisfies ",
                    _ => " as ",
                })?;
                self.ty(ty)
            }
            ExprKind::AsConst(expr) => {
                if e.is_angle_bracket_assertion() {
                    return Err(Refused);
                }
                self.expr(expr, Place::Other)?;
                self.token(" as const")
            }
            ExprKind::NonNull(expr) => {
                if e.non_null_count() != 1 {
                    return Err(Refused);
                }
                self.expr(expr, Place::Object)?;
                self.byte(b'!')
            }
            ExprKind::Jsx(_) => self.jsx(e, false),
            ExprKind::Regex(regex) if regex.flags().is_sorted() => {
                let text = self.text_of(e.span());
                match text.iter().all(|byte| *byte >= b' ') {
                    true => self.long_bytes(text),
                    false => Err(Refused),
                }
            }
            ExprKind::Yield { value, star } => {
                self.token(match star {
                    true => "yield*",
                    false => "yield",
                })?;
                match value {
                    Some(value) => {
                        self.byte(b' ')?;
                        self.expr(value, Place::Other)
                    }
                    None => Ok(()),
                }
            }
            ExprKind::ImportCall { args } if e.import_call_phase().is_none() => {
                if is_composition(args) {
                    return Err(Refused);
                }
                self.token("import(")?;
                self.list(args.iter(), |line, argument| {
                    line.expr(argument, Place::Free)
                })?;
                self.byte(b')')
            }
            // `new.a` is an error that the parser recovers from.
            ExprKind::ImportMeta | ExprKind::NewTarget
                if matches!(self.text_of(e.span()), b"import.meta" | b"new.target") =>
            {
                self.source(e.span())
            }
            ExprKind::BigInt(_) => {
                let text = self.text_of(e.span());
                match text.iter().any(u8::is_ascii_uppercase) {
                    true => Err(Refused),
                    false => self.long_bytes(text),
                }
            }
            _ => Err(Refused),
        }
    }

    /// A string literal at `span`, with the quotes of the options. The text has no backslash.
    pub(super) fn string(&mut self, span: Span) -> Written {
        if self.is_careful {
            return self.odd_string(span);
        }
        let text = self.text_of(span);
        let [first @ (b'"' | b'\''), content @ .., last] = text else {
            return Err(Refused);
        };
        if first != last {
            return Err(Refused);
        }
        let preferred = self.f.options().quote_style.as_byte();
        // A tab has no width. A string with the preferred quote in it keeps the other one.
        let (mut has_preferred, mut has_odd) = (false, false);
        for &byte in content {
            has_preferred |= byte == preferred;
            has_odd |= byte < b' ';
        }
        if has_odd {
            return Err(Refused);
        }
        if *first == preferred || has_preferred {
            return self.source(span);
        }
        self.byte(preferred)?;
        self.source(span.shrink(1, 1))?;
        self.byte(preferred)
    }

    /// A template on one line that's in no other language: not a property's value, an element or tagged.
    pub(super) fn template(&mut self, e: Expr<'a>) -> Written {
        let template = e.as_template().ok_or(Refused)?;
        if !self.text_of(e.span()).iter().all(|byte| *byte >= b' ') {
            return Err(Refused);
        }
        // `/* GraphQL */` can be on a line before the statement. Anywhere else it's in what's checked for comments.
        let starts_statement = match e.parent() {
            Node::Stmt(_) => true,
            Node::Expr(parent) => matches!(parent.tag(), ExprTag::As | ExprTag::AsConst),
            _ => false,
        };
        if starts_statement && crate::graphql::embed::may_have_language_comment(e, self.f) {
            return Err(Refused);
        }
        let expressions = template.exprs();
        self.byte(b'`')?;
        for i in 0..template.quasi_count() {
            self.long_bytes(template.raw(i))?;
            if let Some(expression) = expressions.get(i) {
                self.token("${")?;
                self.expr(expression, Place::Other)?;
                self.byte(b'}')?;
            }
        }
        self.byte(b'`')
    }

    /// Looks at the chain that the call `e`, whose callee is a member access, ends.
    pub(super) fn check_member_chain(&mut self, e: Expr<'a>) -> Result<ChainShape, Refused> {
        let mut calls = 0;
        let mut has_function = false;
        let mut link = e;
        loop {
            link = match link.tag() {
                ExprTag::Call => {
                    let call = link.as_call().ok_or(Refused)?;
                    if calls > 0 {
                        has_function |= call.args().iter().any(|it| it.tag() == ExprTag::Fn);
                    }
                    calls += 1;
                    call.callee()
                }
                ExprTag::Dot | ExprTag::Index => link.object().ok_or(Refused)?,
                ExprTag::NonNull => link.operand().ok_or(Refused)?,
                _ => break,
            };
        }
        if calls <= 2 {
            // A chain breaks if its last call does and an earlier one has a function among its arguments.
            return Ok(match calls == 1 || !has_function {
                true => ChainShape::OneLine { can_end_line: true },
                false => ChainShape::Groups,
            });
        }
        let mut link = e;
        loop {
            link = match link.tag() {
                ExprTag::Call => {
                    let call = link.as_call().ok_or(Refused)?;
                    let f = &*self.f;
                    // It breaks whether it fits or not.
                    if !(call.args().iter()).all(|it| SimpleArgument::new(it, f).is_simple()) {
                        return Ok(ChainShape::Groups);
                    }
                    call.callee()
                }
                ExprTag::Dot | ExprTag::Index => link.object().ok_or(Refused)?,
                ExprTag::NonNull => link.operand().ok_or(Refused)?,
                _ => {
                    return Ok(ChainShape::OneLine {
                        can_end_line: false,
                    });
                }
            };
        }
    }

    /// True if `argument` is certain to break, and is hugged as the last argument of a call.
    pub(super) fn ends_line(&self, argument: Expr<'a>) -> bool {
        match argument.tag() {
            ExprTag::Fn => (argument.as_fn())
                .and_then(Func::body_statements)
                .is_some_and(|statements| !is_empty_block(statements)),
            ExprTag::Object => self.is_broken_object(argument),
            _ => false,
        }
    }

    /// True if the object `e` is certain to break: its first key is on a new line.
    pub(super) fn is_broken_object(&self, e: Expr<'a>) -> bool {
        (e.as_object().and_then(List::first)).is_some_and(|first| {
            self.f.options().expand == Expand::Auto
                && self.has_line_break_in(Span::new(e.span().start, first.span().start))
        })
    }

    /// The arguments of the call or `new` expression `e`. `is_last`: nothing but closing brackets follows. `can_break`:
    /// nothing before the `(` can break.
    pub(super) fn arguments(
        &mut self,
        e: Expr<'a>,
        args: List<'a, Expr<'a>>,
        is_last: bool,
        can_break: bool,
    ) -> Written {
        self.byte(b'(')?;
        let count = args.len();
        if count == 0 {
            return self.byte(b')');
        }
        let (mut has_function, mut has_call) = (false, false);
        if count > 1 {
            for argument in args {
                has_function |= argument.tag() == ExprTag::Fn;
                has_call |= matches!(argument.tag(), ExprTag::Call | ExprTag::NonNull);
            }
        }
        if (has_function || has_call)
            && is_composition(args)
            && !matches!(e.as_chain_element().parent(), AstNodes::Decorator(_))
        {
            // Each is on a line, unless it's a test: `it("name", fakeAsync(() => {`
            if !is_last {
                return Err(Refused);
            }
            if self.keeps_test_on_one_line(e)? {
                return self.hugged_last_argument(args, args.last().ok_or(Refused)?);
            }
            return match can_break {
                true => self.arguments_each_on_a_line(args),
                false => Err(Refused),
            };
        }
        if is_last && let Some(last) = args.last() {
            if self.breaks && can_break {
                return self.arguments_too_wide(e, args);
            }
            if has_function
                && !self.breaks
                && let Some(function) = function_before_last_argument(args)
            {
                return self.arguments_after_function(e, args, function);
            }
            // `beforeEach(fakeAsync(() => {`
            if count == 1
                && last.tag() == ExprTag::Call
                && e.as_call().is_some_and(is_unbreakable_test_call)
                && self.keeps_test_on_one_line(e)?
            {
                return self.hugged_last_argument(args, last);
            }
            if self.ends_line(last) {
                // Two arguments of the same kind aren't hugged.
                if count > 1
                    && (args.get(count - 2)).is_some_and(|it| {
                        it.tag() == last.tag() || matches!(it.tag(), ExprTag::Fn | ExprTag::Cond)
                    })
                {
                    return Err(Refused);
                }
                return self.hugged_last_argument(args, last);
            }
        }
        let mark = self.spot();
        let written = self
            .list(args.iter(), |line, argument| {
                line.expr(argument, Place::Free)
            })
            .and_then(|()| self.byte(b')'));
        if written.is_ok() {
            return Ok(());
        }
        if !is_last || !can_break || self.breaks || self.is_too_wide {
            return Err(Refused);
        }
        self.back_to(mark);
        self.arguments_with_forced_line_break(e, args)
    }

    /// All arguments but `last` on the line, and `last`, which breaks.
    pub(super) fn hugged_last_argument(
        &mut self,
        args: List<'a, Expr<'a>>,
        last: Expr<'a>,
    ) -> Written {
        if let Some(function) = last.as_fn() {
            self.check_parameters_of_hugged(function)?;
        }
        for argument in args.iter().take(args.len().saturating_sub(1)) {
            self.expr(argument, Place::Free)?;
            self.token(", ")?;
        }
        self.tail += 1;
        let written = match last.as_fn() {
            Some(function) if self.breaks => {
                self.nested(|line| line.function_too_wide(function, true))
            }
            _ => self.last_expr(last, Place::Free),
        };
        self.tail -= 1;
        written?;
        self.byte(b')')
    }

    /// The arguments of `e` after the `(`, where they're too wide for the line.
    fn arguments_too_wide(&mut self, e: Expr<'a>, args: List<'a, Expr<'a>>) -> Written {
        if self.width != Width::Known {
            return Err(Refused);
        }
        let parent = match e.tag() {
            ExprTag::Call => AstNodes::CallExpression(e),
            _ => e.as_chain_element(),
        };
        let last = args.last().ok_or(Refused)?;
        match arguments_layout(args, parent, self.f) {
            ArgumentsLayout::Default | ArgumentsLayout::AllBrokenOut => {}
            ArgumentsLayout::Grouped(GroupedCallArgumentLayout::GroupedLastArgument) => {
                // What's hugged has to break, and the line has to fit up to there.
                let is_known = match last.tag() {
                    ExprTag::Object | ExprTag::Array => true,
                    ExprTag::As | ExprTag::AsConst | ExprTag::Satisfies => self
                        .before_suffix(last)
                        .is_some_and(|it| matches!(it.tag(), ExprTag::Object | ExprTag::Array)),
                    ExprTag::Fn => last.as_fn().is_some_and(|function| {
                        function.is_arrow()
                            || (self.ends_line(last)
                                && hugged_function_keeps_parameters_on_one_line(
                                    function,
                                    args.len(),
                                    parent,
                                    self.f,
                                ))
                    }),
                    _ => false,
                };
                if !is_known {
                    return Err(Refused);
                }
                let mark = self.spot();
                self.is_too_wide = false;
                if self.hugged_last_argument(args, last).is_ok() {
                    return Ok(());
                }
                if !self.is_first_line_too_wide(mark) {
                    return Err(Refused);
                }
                self.back_to(mark);
            }
            _ => return Err(Refused),
        }
        self.arguments_each_on_a_line(args)
    }

    /// True if `e` is the call of a function of a test framework, whose arguments stay on one line however long they
    /// are. Refuses it if something in them can break.
    fn keeps_test_on_one_line(&mut self, e: Expr<'a>) -> Result<bool, Refused> {
        let Some(call) = e.as_call() else {
            return Ok(false);
        };
        if !keeps_arguments_on_one_line(e, call, self.f) {
            return Ok(false);
        }
        if !is_unbreakable_test_call(call) {
            return Err(Refused);
        }
        self.keep_on_one_line(e);
        Ok(true)
    }

    /// Nothing can break in `e`. So it's on one line however long it is, unless something before it breaks instead.
    fn keep_on_one_line(&mut self, e: Expr<'a>) {
        self.breaks = false;
        if starts_statement(e) {
            self.limit = usize::MAX;
        }
    }

    /// The arguments of `e` after the `(`, of which `function`, which has statements in it, isn't the last:
    /// `setTimeout(() => {`, `useEffect(() => {`.
    fn arguments_after_function(
        &mut self,
        e: Expr<'a>,
        args: List<'a, Expr<'a>>,
        function: Expr<'a>,
    ) -> Written {
        let parent = match e.tag() {
            ExprTag::Call => AstNodes::CallExpression(e),
            _ => e.as_chain_element(),
        };
        if !matches!(
            arguments_layout(args, parent, self.f),
            ArgumentsLayout::ReactHook
                | ArgumentsLayout::Grouped(GroupedCallArgumentLayout::GroupedFirstArgument)
        ) {
            return Err(Refused);
        }
        self.check_parameters_of_hugged(function.as_fn().ok_or(Refused)?)?;
        self.list(args.iter(), |line, argument| match argument == function {
            true => line.function(function.as_fn().ok_or(Refused)?, true),
            false => line.expr(argument, Place::Free),
        })?;
        self.byte(b')')
    }

    /// The arguments after the `(`, each on a line.
    pub(super) fn arguments_each_on_a_line(&mut self, args: List<'a, Expr<'a>>) -> Written {
        let has_last_comma = self.has_trailing_comma(true);
        let count = args.len();
        self.break_line(1)?;
        for (index, argument) in args.iter().enumerate() {
            if index > 0 {
                self.break_line(0)?;
            }
            let has_comma = index + 1 < count || has_last_comma;
            self.expr_before_line_break(argument, usize::from(has_comma))?;
            if has_comma {
                self.byte(b',')?;
            }
        }
        self.break_line(-1)?;
        self.byte(b')')
    }

    pub(super) fn array(&mut self, e: Expr<'a>, is_last: bool) -> Written {
        let elements = e.as_array().ok_or(Refused)?;
        if e.is_assignment_target() {
            return Err(Refused);
        }
        if is_last && self.breaks && !elements.is_empty() {
            return self.end_line_with(Part::Broken(e), e.span(), 1);
        }
        let mark = self.spot();
        let written = self.array_on_one_line(elements);
        if written.is_ok() || !is_last || self.is_too_wide || !self.is_certain_to_break(e) {
            return written;
        }
        self.back_to(mark);
        self.end_line_with(Part::Broken(e), e.span(), 1)
    }

    fn array_on_one_line(&mut self, elements: List<'a, Expr<'a>>) -> Written {
        // Several objects, or several arrays, are each on a line.
        if elements.len() > 1
            && elements
                .first()
                .is_some_and(|it| matches!(it.tag(), ExprTag::Object | ExprTag::Array))
        {
            return Err(Refused);
        }
        self.byte(b'[')?;
        self.list(elements.iter(), |line, element| match element.tag() {
            ExprTag::Missing | ExprTag::Template => Err(Refused),
            _ => line.expr(element, Place::Free),
        })?;
        self.byte(b']')
    }

    pub(super) fn object(&mut self, e: Expr<'a>, is_last: bool) -> Written {
        let props = e.as_object().ok_or(Refused)?;
        if e.is_assignment_target() {
            return Err(Refused);
        }
        if props.is_empty() {
            return self.token("{}");
        }
        if is_last && self.breaks {
            return self.end_line_with(Part::Broken(e), e.span(), 1);
        }
        if self.is_broken_object(e) {
            return match is_last {
                true => self.end_line_with(Part::Broken(e), e.span(), 1),
                false => Err(Refused),
            };
        }
        let mark = self.spot();
        // Whether a key has quotes depends on the other keys.
        let is_consistent = self.f.options().quote_properties.is_consistent();
        if is_consistent {
            let f = &*self.f;
            let needs_quotes = props.iter().any(|prop| {
                prop.kind() != PropKind::Spread
                    && prop.key().is_some_and(|key| should_preserve_quote(key, f))
            });
            self.f.context_mut().push_quote_needed(needs_quotes);
        }
        let written = (self.open_brace())
            .and_then(|()| self.list(props.iter(), |line, prop| line.property(prop, false)))
            .and_then(|()| self.close_brace());
        if is_consistent {
            self.f.context_mut().pop_quote_needed();
        }
        if written.is_ok() || !is_last || self.is_too_wide || !self.is_certain_to_break(e) {
            return written;
        }
        self.back_to(mark);
        self.end_line_with(Part::Broken(e), e.span(), 1)
    }

    /// A key that's a plain name. Whether another kind of key gets or loses quotes depends on the other keys.
    pub(super) fn key(&mut self, key: Option<Key<'a>>) -> Written {
        let key = key.ok_or(Refused)?;
        if !matches!(key.kind(), KeyKind::Ident(_))
            || self.f.options().quote_properties.is_consistent()
        {
            return Err(Refused);
        }
        let span = key.span(self.f.file());
        self.source(span)
    }

    /// The key of `prop`, a property of an object.
    fn property_key(&mut self, prop: Prop<'a>) -> Written {
        let key = prop.key().ok_or(Refused)?;
        match key.kind() {
            KeyKind::Ident(_) if !self.f.options().quote_properties.is_consistent() => {
                let span = key.span(self.f.file());
                self.source(span)
            }
            KeyKind::Computed(e) => {
                self.byte(b'[')?;
                self.expr(e, Place::Free)?;
                self.byte(b']')
            }
            KeyKind::Private(_) => Err(Refused),
            _ => self.key_with_or_without_quotes(key, prop),
        }
    }

    #[inline(never)]
    fn key_with_or_without_quotes(&mut self, key: Key<'a>, prop: Prop<'a>) -> Written {
        let span = key.inner_span(self.f.file());
        let printed = printed_key(key, span, prop.as_ast_nodes(), self.f);
        if let (KeyKind::Ident(_), std::borrow::Cow::Borrowed(_)) = (key.kind(), &printed) {
            return self.source(span);
        }
        if !printed.iter().all(|byte| *byte >= b' ') {
            return Err(Refused);
        }
        if !key.is_computed() {
            return self.long_bytes(&printed);
        }
        self.byte(b'[')?;
        self.long_bytes(&printed)?;
        self.byte(b']')
    }

    pub(super) fn property(&mut self, prop: Prop<'a>, is_last: bool) -> Written {
        if !prop.modifiers().is_empty() && prop.func().is_none() {
            return Err(Refused);
        }
        match prop.kind() {
            PropKind::Init => {
                self.property_key(prop)?;
                self.token(": ")?;
                let value = prop.value().ok_or(Refused)?;
                match (value.tag(), is_last) {
                    // It can be in another language.
                    (ExprTag::Template, _) if may_be_in_another_language(value, self.f) => {
                        Err(Refused)
                    }
                    (_, true) => self.last_assigned(value),
                    (_, false) => self.assigned(value),
                }
            }
            PropKind::Shorthand => match prop.value() {
                Some(value) if value.tag() == ExprTag::Ident => self.source(value.span()),
                _ => Err(Refused),
            },
            PropKind::Spread => {
                self.token("...")?;
                self.expr(prop.value().ok_or(Refused)?, Place::Other)
            }
            kind @ (PropKind::Method | PropKind::Getter | PropKind::Setter) => {
                let func = prop.func().ok_or(Refused)?;
                if prop.is_optional() {
                    return Err(Refused);
                }
                match kind {
                    PropKind::Getter => self.token("get ")?,
                    PropKind::Setter => self.token("set ")?,
                    _ => {}
                }
                if func.is_async() {
                    self.token("async ")?;
                }
                if func.is_generator() {
                    self.byte(b'*')?;
                }
                self.property_key(prop)?;
                self.signature(func)?;
                self.body(func, is_last)
            }
        }
    }

    /// `<T>(a: A): B`
    pub(super) fn signature(&mut self, func: Func<'a>) -> Written {
        self.type_parameters(func.type_params())?;
        self.parameters(func)?;
        self.type_annotation(func.return_type())
    }

    /// A function. Unless `is_last`, the body of an arrow function is an expression or empty, and that of any other
    /// function is empty.
    pub(super) fn function(&mut self, func: Func<'a>, is_last: bool) -> Written {
        if is_last && self.breaks && func.kind() != FnKind::Decl {
            return self.function_too_wide(func, false);
        }
        self.function_keywords(func)?;
        if !func.is_arrow() {
            self.signature(func)?;
            return match func.has_body() {
                true => self.body(func, is_last),
                false => Ok(()),
            };
        }
        if !func.type_params().is_empty() {
            return Err(Refused);
        }
        match can_avoid_parentheses(func, self.f) {
            true => self.lone_parameter(func)?,
            false => self.parameters(func)?,
        }
        self.type_annotation(func.return_type())?;
        self.token(" =>")?;
        let FnBody::Expr(body) = func.body() else {
            return self.body(func, is_last);
        };
        if is_last {
            return self.arrow_body(func, body, false);
        }
        self.byte(b' ')?;
        match body.tag() {
            // A chain of arrow functions has a layout of its own.
            ExprTag::Fn => Err(Refused),
            ExprTag::Binary if body.binary_op() == Some(BinOp::Comma) => Err(Refused),
            // In parentheses, unless it breaks or starts with an object.
            ExprTag::Cond if matches!(self.text_of(body.span()), [b'(' | b'{', ..]) => Err(Refused),
            ExprTag::Cond => {
                self.byte(b'(')?;
                self.expr(body, Place::Other)?;
                self.byte(b')')
            }
            ExprTag::Jsx if is_last => self.last_expr(body, Place::Other),
            _ => self.expr(body, Place::Other),
        }
    }

    /// ` {}`, or ` {` and the rest of the body if it can end the line.
    pub(super) fn body(&mut self, func: Func<'a>, is_last: bool) -> Written {
        let (Some(statements), Some(span)) = (func.body_statements(), func.body_span()) else {
            return Err(Refused);
        };
        if statements.is_empty() {
            return self.token(" {}");
        }
        if !is_last || is_empty_block(statements) {
            return Err(Refused);
        }
        if !self.is_quiet {
            let owned = self.f.comments().of_node(AstNodes::FunctionBody(func));
            if owned.is_ignored || !owned.leading.is_empty() || !owned.dangling.is_empty() {
                return Err(Refused);
            }
        }
        self.end_line_with(Part::Body(func), span, 2)
    }
}
