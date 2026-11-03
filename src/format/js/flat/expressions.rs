//! Expressions.

use super::*;

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
            // Where a call that's too wide breaks depends on what it's assigned to.
            ExprTag::Call | ExprTag::New | ExprTag::Await if self.breaks => Err(Refused),
            _ => self.last_expr(value, Place::Free),
        }
    }

    /// An expression with nothing but closing brackets after it, so that it can end the line.
    pub(super) fn last_expr(&mut self, e: Expr<'a>, place: Place) -> Written {
        let tag = e.tag();
        if !matches!(
            tag,
            ExprTag::Fn
                | ExprTag::Object
                | ExprTag::Array
                | ExprTag::Call
                | ExprTag::New
                | ExprTag::Await
                | ExprTag::Assign
                | ExprTag::Jsx
        ) || (place != Place::Free && needs_parentheses(e, self.f))
            || (tag == ExprTag::Call && e.is_chain_root())
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
                line.token("await ")?;
                line.last_expr(e.operand().ok_or(Refused)?, Place::Other)
            }
            ExprTag::Jsx => line.jsx(e, true),
            _ => line.assignment(e, true),
        })
    }

    pub(super) fn new_expression(&mut self, e: Expr<'a>, is_last: bool) -> Written {
        let call = e.as_new().ok_or(Refused)?;
        self.check_flow_new(e, call.callee())?;
        self.token("new ")?;
        self.expr(call.callee(), Place::Other)?;
        self.type_arguments(call.type_args())?;
        self.arguments(call.args(), is_last, false)
    }

    pub(super) fn call(&mut self, e: Expr<'a>, is_last: bool) -> Written {
        let call = e.as_call().ok_or(Refused)?;
        let callee = call.callee();
        let mut is_plain_callee = true;
        if matches!(callee.tag(), ExprTag::Dot | ExprTag::Index) {
            is_plain_callee = self.check_member_chain(e)?;
        } else if callee.tag() == ExprTag::Ident {
            // `graphql(schema, `..`)` has another language in it.
            if callee.span().len() == 7 && self.text_of(callee.span()) == b"graphql" {
                return Err(Refused);
            }
        } else {
            is_plain_callee = false;
        }
        // The arguments of a test, of `require` and the like stay on one line however long they are.
        if self.breaks && keeps_arguments_on_one_line(e, call, self.f) {
            // Only where nothing in them can break either: `it("name", (done) => {`
            let args = call.args();
            let is_unbreakable = is_last
                && callee.tag() == ExprTag::Ident
                && args.len() == 2
                && args.first().is_some_and(|it| it.tag() == ExprTag::String)
                && (args.last().filter(|it| self.ends_line(*it)))
                    .and_then(Expr::as_fn)
                    .is_some_and(|func| {
                        func.return_type().is_none()
                            && func.type_params().is_empty()
                            && func.params().iter().all(|param| {
                                param.pat().tag() == PatTag::Ident
                                    && param.ty().is_none()
                                    && param.default().is_none()
                            })
                    });
            if !is_unbreakable {
                return Err(Refused);
            }
            (self.limit, self.breaks) = (usize::MAX, false);
        }
        self.expr(callee, Place::Object)?;
        if call.is_optional() {
            self.token("?.")?;
        }
        self.type_arguments(call.type_args())?;
        self.arguments(call.args(), is_last && is_plain_callee, is_plain_callee)
    }

    pub(super) fn assignment(&mut self, e: Expr<'a>, is_last: bool) -> Written {
        let (op, target, value) = e.as_assign().ok_or(Refused)?;
        if matches!(target.tag(), ExprTag::Object | ExprTag::Array)
            || !matches!(e.as_chain_element(), AstNodes::AssignmentExpression(_))
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
        let is_link = matches!(
            tag,
            ExprTag::Dot | ExprTag::Index | ExprTag::Call | ExprTag::NonNull
        );
        let has_parentheses = match place {
            Place::Free => tag == ExprTag::Assign && needs_parentheses(e, self.f),
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

    /// Looks at the chain that the call `e`, whose callee is a member access, ends. A chain with more than two calls
    /// breaks if an argument isn't simple, whether it fits or not. Returns true if the last call can end the line.
    pub(super) fn check_member_chain(&mut self, e: Expr<'a>) -> Result<bool, Refused> {
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
            // A chain breaks if its last call does and an earlier one has a function among its arguments. Where a chain
            // that's too wide breaks is another matter, unless all that's before the last `(` is names.
            return Ok(match self.breaks {
                true => calls == 1 && matches!(link.tag(), ExprTag::Ident | ExprTag::This),
                false => calls == 1 || !has_function,
            });
        }
        let mut link = e;
        loop {
            link = match link.tag() {
                ExprTag::Call => {
                    let call = link.as_call().ok_or(Refused)?;
                    let f = &*self.f;
                    if !(call.args().iter()).all(|it| SimpleArgument::new(it, f).is_simple()) {
                        return Err(Refused);
                    }
                    call.callee()
                }
                ExprTag::Dot | ExprTag::Index => link.object().ok_or(Refused)?,
                ExprTag::NonNull => link.operand().ok_or(Refused)?,
                _ => return Ok(false),
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

    /// True if the object `e` is certain to break: its first key is on a new line, or all of this is too wide.
    pub(super) fn is_broken_object(&self, e: Expr<'a>) -> bool {
        (e.as_object().and_then(List::first)).is_some_and(|first| {
            self.breaks
                || (self.f.options().expand == Expand::Auto
                    && self.has_line_break_in(Span::new(e.span().start, first.span().start)))
        })
    }

    /// `is_last`: nothing but closing brackets follows. `can_break`: nothing before the `(` can break.
    pub(super) fn arguments(
        &mut self,
        args: List<'a, Expr<'a>>,
        is_last: bool,
        can_break: bool,
    ) -> Written {
        self.byte(b'(')?;
        let count = args.len();
        if count > 1 {
            self.check_composition(args)?;
        }
        if is_last && let Some(last) = args.last() {
            if self.ends_line(last) {
                // Two arguments of the same kind aren't hugged.
                if count > 1
                    && (args.get(count - 2)).is_some_and(|it| {
                        it.tag() == last.tag() || matches!(it.tag(), ExprTag::Fn | ExprTag::Cond)
                    })
                {
                    return Err(Refused);
                }
                for argument in args.iter().take(count - 1) {
                    self.expr(argument, Place::Free)?;
                    self.token(", ")?;
                }
                self.last_expr(last, Place::Free)?;
                return self.byte(b')');
            }
            // Too wide, and no argument is hugged: each is on a line.
            if self.breaks
                && can_break
                && !args.iter().any(|it| {
                    matches!(
                        it.tag(),
                        ExprTag::Fn
                            | ExprTag::Object
                            | ExprTag::Array
                            | ExprTag::As
                            | ExprTag::AsConst
                            | ExprTag::Satisfies
                            | ExprTag::Template
                            | ExprTag::TaggedTemplate
                            | ExprTag::Spread
                            | ExprTag::Jsx
                    )
                })
            {
                let has_last_comma = self.has_trailing_comma(true);
                self.lines(count, args.iter(), has_last_comma, |line, argument| {
                    line.expr_on_own_line(argument)
                })?;
                return self.byte(b')');
            }
        }
        self.list(args.iter(), |line, argument| {
            line.expr(argument, Place::Free)
        })?;
        self.byte(b')')
    }

    /// Several functions among the arguments, or in the arguments of an argument, are each on a line.
    pub(super) fn check_composition(&mut self, args: List<'a, Expr<'a>>) -> Written {
        let mut functions = 0;
        for argument in args {
            match argument.tag() {
                ExprTag::Fn => functions += 1,
                ExprTag::Call | ExprTag::NonNull => {
                    let mut inner = argument;
                    while inner.tag() == ExprTag::NonNull {
                        inner = inner.operand().ok_or(Refused)?;
                    }
                    if inner
                        .as_call()
                        .is_some_and(|call| call.args().iter().any(|it| it.tag() == ExprTag::Fn))
                    {
                        return Err(Refused);
                    }
                }
                _ => {}
            }
        }
        match functions > 1 {
            true => Err(Refused),
            false => Ok(()),
        }
    }

    pub(super) fn array(&mut self, e: Expr<'a>, is_last: bool) -> Written {
        let elements = e.as_array().ok_or(Refused)?;
        if e.is_assignment_target() {
            return Err(Refused);
        }
        if is_last && self.breaks && !elements.is_empty() {
            return self.end_line_with(Part::Broken(e), e.span(), 1);
        }
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
        if self.is_broken_object(e) {
            return match is_last {
                true => self.end_line_with(Part::Broken(e), e.span(), 1),
                false => Err(Refused),
            };
        }
        self.open_brace()?;
        self.list(props.iter(), |line, prop| line.property(prop, false))?;
        self.close_brace()
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

    pub(super) fn property(&mut self, prop: Prop<'a>, is_last: bool) -> Written {
        if !prop.modifiers().is_empty() && prop.func().is_none() {
            return Err(Refused);
        }
        match prop.kind() {
            PropKind::Init => {
                self.key(prop.key())?;
                self.token(": ")?;
                let value = prop.value().ok_or(Refused)?;
                match (value.tag(), is_last) {
                    // It can be in another language.
                    (ExprTag::Template, _) => Err(Refused),
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
                self.key(prop.key())?;
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
        if func.is_async() {
            self.token("async ")?;
        }
        if !func.is_arrow() {
            self.token(match func.is_generator() {
                true => "function* ",
                false => "function ",
            })?;
            if let Some(name) = func.name() {
                self.source(name.span())?;
            }
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
            true => self.pattern(func.params().first().ok_or(Refused)?.pat())?,
            false => self.parameters(func)?,
        }
        self.type_annotation(func.return_type())?;
        self.token(" =>")?;
        let FnBody::Expr(body) = func.body() else {
            return self.body(func, is_last);
        };
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
