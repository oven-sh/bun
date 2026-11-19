use super::super::emit::operand_needs_parentheses;
use super::*;

const COMPARE: u8 = 8;

#[inline]
fn precedence(token: T) -> u8 {
    match token {
        T::QuestionQuestion => 1,
        T::BarBar => 2,
        T::AmpAmp => 3,
        T::Bar => 4,
        T::Caret => 5,
        T::Amp => 6,
        T::EqEq | T::BangEq | T::EqEqEq | T::BangEqEq => 7,
        T::Lt | T::Gt | T::LtEq | T::GtEq | T::In | T::Instanceof | T::As | T::Satisfies => COMPARE,
        T::Shl | T::Shr | T::UShr => 9,
        T::Plus | T::Minus => 10,
        T::Star | T::Slash | T::Percent => 11,
        T::StarStar => 12,
        _ => 0,
    }
}

/// Whose parameters are being parsed.
#[derive(Copy, Clone, PartialEq, Eq)]
pub(super) enum Owner {
    Function,
    /// Of a class
    Method,
    Arrow,
    Constructor,
    Signature,
}

impl Parser<'_> {
    pub(super) fn expression(&mut self) -> P {
        let (start, token) = (self.start(), self.token());
        let first = self.assignment()?;
        if self.token() != T::Comma {
            return Some(first);
        }
        self.unsure_if(matches!(
            token,
            T::OpenBrace | T::Function | T::Class | T::Async
        ));
        let base = self.list_base();
        self.push(first);
        while self.eat(T::Comma) {
            let next = self.assignment()?;
            self.push(next);
        }
        self.add_list(K::Seq, 0, start, base)
    }

    pub(super) fn expression_in_brackets(&mut self) -> P {
        self.in_brackets(Self::expression)
    }

    pub(super) fn assignment_in_brackets(&mut self) -> P {
        self.in_brackets(Self::assignment)
    }

    pub(super) fn assignment(&mut self) -> P {
        let start = self.start();
        let head = match self.token() {
            T::Ident => self.leaf(K::Ident),
            T::Str => self.string()?,
            T::Num => self.number(),
            T::Null => self.leaf(K::Null),
            T::True | T::False => self.leaf(K::Bool),
            T::This => self.leaf(K::This),
            T::OpenBrace => self.object()?,
            T::OpenBracket => self.array()?,
            _ => return self.other_assignment(start),
        };
        if self.token().ends_expression() {
            return Some(head);
        }
        let e = self.members_and_calls(start, head, true)?;
        if self.token().ends_expression() {
            return Some(e);
        }
        self.enter()?;
        let e = self.postfix(start, e)?;
        let e = self.binary_rest(start, e, 0)?;
        let e = self.assignment_rest(start, e)?;
        self.leave();
        Some(e)
    }

    fn other_assignment(&mut self, start: u32) -> P {
        self.enter()?;
        let arrow = match self.token() {
            T::OpenParen | T::Lt | T::Async => self.try_arrow(start)?,
            T::Yield => Some(self.yield_expression(start)?),
            _ => None,
        };
        let e = match arrow {
            Some(arrow) => arrow,
            None => {
                let left = self.binary(0)?;
                self.assignment_rest(start, left)?
            }
        };
        self.leave();
        Some(e)
    }

    fn assignment_rest(&mut self, start: u32, left: Id) -> P {
        let token = self.token();
        match token {
            T::Question => self.conditional(start, left),
            T::Arrow => self.arrow_after_name(start, left, 0),
            _ if token.is_assignment() => {
                match token == T::Eq {
                    true => self.to_target(left)?,
                    false => require(self.is_simple_target(left))?,
                }
                self.pass_infix();
                let right = self.assignment()?;
                self.odd_if(self.node(left).has(flag::TARGET));
                let id = self.add(K::Assign, token, 0, start, [left, right, NONE, NONE]);
                self.odd();
                Some(id)
            }
            _ => Some(left),
        }
    }

    fn conditional(&mut self, start: u32, test: Id) -> P {
        self.pass_infix();
        let ctx = self.ctx & !ctx::NO_IN | ctx::BEFORE_COLON;
        let yes = self.with(ctx, Self::assignment)?;
        require(self.eat_infix(T::Colon))?;
        let no = self.assignment()?;
        let gets_parentheses = |id: Id| {
            let node = self.node(id);
            matches!(node.kind, K::As | K::Satisfies) || node.op == T::QuestionQuestion
        };
        self.odd_if(
            [test, yes, no].into_iter().any(gets_parentheses)
                || self.kind(test) == K::Await
                || self.kind(yes) == K::Cond,
        );
        Some(self.add(K::Cond, T::Unknown, 0, start, [test, yes, no, NONE]))
    }

    fn yield_expression(&mut self, start: u32) -> P {
        require(self.has(ctx::YIELD))?;
        self.next();
        let (mut flags, mut argument) = (0, NONE);
        if !self.newline_before() {
            if self.eat(T::Star) {
                flags = flag::STAR;
            }
            let ends = matches!(
                self.token(),
                T::CloseParen
                    | T::CloseBracket
                    | T::CloseBrace
                    | T::Comma
                    | T::Semicolon
                    | T::Colon
                    | T::Eof
            );
            if flags != 0 || !ends {
                argument = self.assignment()?;
            }
        }
        Some(self.add(
            K::Yield,
            T::Unknown,
            flags,
            start,
            [argument, NONE, NONE, NONE],
        ))
    }

    fn is_simple_target(&self, mut id: Id) -> bool {
        loop {
            let node = self.node(id);
            match node.kind {
                K::Ident => return !matches!(node.op, T::Eval | T::Arguments),
                K::Dot | K::Index => return !node.has(flag::CHAIN),
                K::NonNull => id = node.a,
                K::As | K::Satisfies if node.has(flag::PARENS) => id = node.a,
                _ => return false,
            }
        }
    }

    /// `id` turns out to be the left side of an assignment.
    pub(super) fn to_target(&mut self, id: Id) -> P<()> {
        let node = *self.node(id);
        if !matches!(node.kind, K::Array | K::Object) {
            return require(self.is_simple_target(id));
        }
        require(!node.has(flag::PARENS))?;
        self.flag(id, flag::TARGET | flag::ODD);
        for i in 0..node.len as usize {
            let item = *self.tree.list_of(&node).get(i)?;
            let child = *self.node(item);
            match child.kind {
                K::Hole => {}
                K::Spread => {
                    let is_last = i + 1 == node.len as usize && !node.has(flag::TRAILING_COMMA);
                    let is_nested = matches!(self.kind(child.a), K::Array | K::Object);
                    require(is_last && !(is_nested && node.kind == K::Object))?;
                    self.flag(item, flag::TARGET | flag::ODD);
                    self.to_target(child.a)?;
                }
                K::Prop => {
                    self.flag(item, flag::TARGET | flag::ODD);
                    match child.op {
                        T::Colon => self.to_target_with_default(child.b)?,
                        T::Ident if child.b != NONE => self.shorthand_defaults -= 1,
                        T::Ident => require(self.is_simple_target(child.a))?,
                        _ => return None,
                    }
                }
                _ => self.to_target_with_default(item)?,
            }
        }
        Some(())
    }

    fn to_target_with_default(&mut self, id: Id) -> P<()> {
        let node = *self.node(id);
        if node.kind == K::Assign {
            self.flag(id, flag::TARGET | flag::ODD);
            return require(node.op == T::Eq && !node.has(flag::PARENS));
        }
        self.to_target(id)
    }

    fn binary(&mut self, min: u8) -> P {
        let start = self.start();
        let left = match self.token() {
            T::PrivateName => {
                let name = self.private_name_use()?;
                require(self.token() == T::In && min < COMPARE && !self.has(ctx::NO_IN))?;
                name
            }
            _ => self.unary()?,
        };
        self.binary_rest(start, left, min)
    }

    fn binary_rest(&mut self, start: u32, mut left: Id, min: u8) -> P {
        let mut count = 0;
        loop {
            if self.token() == T::Gt {
                self.lx.rescan_greater_than();
            }
            let op = self.token();
            let level = precedence(op);
            if level <= min && (level == 0 || op != T::StarStar) {
                return Some(left);
            }
            self.add_link(&mut count)?;
            match op {
                T::As | T::Satisfies => {
                    if self.newline_before() {
                        return Some(left);
                    }
                    self.require_typescript()?;
                    self.pass_infix();
                    self.odd_if(matches!(self.kind(left), K::Binary | K::Await));
                    let (kind, ty) = match (op, self.token()) {
                        (T::As, T::Const) => (K::As, self.leaf(K::TypeKeyword)),
                        (T::As, _) => (K::As, self.type_in_expression()?),
                        _ => (K::Satisfies, self.type_in_expression()?),
                    };
                    left = self.add2(kind, start, left, ty);
                    continue;
                }
                T::In if self.has(ctx::NO_IN) => return Some(left),
                T::In => self.unsure_if(self.has(ctx::FOR_INIT)),
                T::StarStar => {
                    let base = self.node(left);
                    let is_unary = matches!(base.kind, K::Unary | K::Await);
                    require(!is_unary || base.has(flag::PARENS))?;
                }
                _ => {}
            }
            self.pass_infix();
            self.enter()?;
            let right = self.binary(level)?;
            self.leave();
            let gets_parentheses = |node: &Node, is_right: bool| match node.kind {
                K::Binary | K::Logical => operand_needs_parentheses(op, node.op, is_right),
                K::As | K::Satisfies | K::Await => true,
                K::Unary => !is_right && matches!(op, T::In | T::Instanceof),
                _ => false,
            };
            self.odd_if(
                gets_parentheses(self.node(left), false)
                    || gets_parentheses(self.node(right), true)
                    || op == T::StarStar,
            );
            let kind = if level <= 3 { K::Logical } else { K::Binary };
            if op == T::QuestionQuestion {
                let is_mixed = |node: &Node| {
                    node.kind == K::Logical && node.op != op && !node.has(flag::PARENS)
                };
                require(!is_mixed(self.node(left)) && !is_mixed(self.node(right)))?;
            }
            left = self.add(kind, op, 0, start, [left, right, NONE, NONE]);
        }
    }

    fn unary(&mut self) -> P {
        let (start, op) = (self.start(), self.token());
        match op {
            T::Bang | T::Tilde | T::Plus | T::Minus | T::Typeof | T::Void | T::Delete => {
                let operand = self.operand()?;
                self.odd_if(self.kind(operand) == K::Await);
                if op == T::Delete {
                    let node = *self.node(operand);
                    let is_member = node.kind == K::Index
                        || (node.kind == K::Dot && self.kind(node.b) != K::PrivateName);
                    self.unsure_if(!is_member);
                }
                Some(self.add(K::Unary, op, 0, start, [operand, NONE, NONE, NONE]))
            }
            T::PlusPlus | T::MinusMinus => {
                let operand = self.operand()?;
                require(self.is_simple_target(operand))?;
                Some(self.add(
                    K::Update,
                    op,
                    flag::PREFIX,
                    start,
                    [operand, NONE, NONE, NONE],
                ))
            }
            T::Await => {
                require(self.has(ctx::AWAIT))?;
                if !self.has(ctx::RETURN) {
                    self.is_module_without_module_syntax |= !self.has_module_syntax;
                    let (next, is_on_next_line) = self.peek();
                    let is_clear =
                        next.is_identifier() || matches!(next, T::New | T::Import | T::This);
                    let is_operator = matches!(next, T::As | T::Satisfies | T::Of | T::Using);
                    require(is_clear && !is_operator && !is_on_next_line)?;
                }
                let operand = self.operand()?;
                Some(self.add1(K::Await, start, operand))
            }
            _ => {
                let operand = self.left_hand_side()?;
                self.postfix(start, operand)
            }
        }
    }

    #[inline]
    fn postfix(&mut self, start: u32, operand: Id) -> P {
        let op = self.token();
        if !matches!(op, T::PlusPlus | T::MinusMinus) || self.newline_before() {
            return Some(operand);
        }
        require(self.is_simple_target(operand))?;
        self.pass(Gap::None, Gap::Open);
        Some(self.add(K::Update, op, 0, start, [operand, NONE, NONE, NONE]))
    }

    fn operand(&mut self) -> P {
        match self.token().is_word() {
            true => self.pass_keyword(),
            false => self.pass_prefix(),
        }
        self.enter()?;
        let operand = self.unary()?;
        self.leave();
        Some(operand)
    }

    #[inline]
    pub(super) fn left_hand_side(&mut self) -> P {
        let start = self.start();
        let head = self.primary()?;
        self.members_and_calls(start, head, true)
    }

    fn members_and_calls(&mut self, start: u32, mut e: Id, allows_calls: bool) -> P {
        let (mut chain, mut count, mut calls) = (0, 0, 0);
        loop {
            e = match self.token() {
                T::Dot => {
                    self.pass(Gap::None, Gap::None);
                    let name = self.member_name(chain)?;
                    self.add(K::Dot, T::Unknown, chain, start, [e, name, NONE, NONE])
                }
                T::OpenParen if allows_calls => self.call(start, e, NONE, chain, &mut calls)?,
                T::OpenBracket => self.index(start, e, chain)?,
                T::Bang if !self.newline_before() => {
                    self.require_typescript()?;
                    self.unsure_if(self.kind(e) == K::NonNull);
                    self.pass(Gap::None, Gap::Open);
                    self.add1(K::NonNull, start, e)
                }
                T::QuestionDot => {
                    require(allows_calls)?;
                    self.pass(Gap::None, Gap::None);
                    chain = flag::CHAIN;
                    let flags = flag::CHAIN | flag::OPTIONAL;
                    match self.token() {
                        T::OpenParen => self.call(start, e, NONE, flags, &mut calls)?,
                        T::OpenBracket => self.index(start, e, flags)?,
                        _ => {
                            let name = self.member_name(chain)?;
                            self.add(K::Dot, T::Unknown, flags, start, [e, name, NONE, NONE])
                        }
                    }
                }
                T::Template | T::TemplateHead => {
                    require(chain == 0)?;
                    require(!self.may_be_class_function(e))?;
                    let template = self.template(true)?;
                    self.add(K::Tagged, T::Unknown, 0, start, [e, NONE, template, NONE])
                }
                T::Lt | T::Shl if self.start() > self.lx.at.prev_end => {
                    require(!self.may_be_type_arguments())?;
                    return Some(e);
                }
                T::Shl => return None,
                T::Lt => {
                    if !allows_calls {
                        return Some(e);
                    }
                    let type_args = self.type_arguments_in_expression()?;
                    match self.token() {
                        T::OpenParen => self.call(start, e, type_args, chain, &mut calls)?,
                        T::Template | T::TemplateHead if chain == 0 => {
                            require(!self.may_be_class_function(e))?;
                            let template = self.template(true)?;
                            let children = [e, type_args, template, NONE];
                            self.add(K::Tagged, T::Unknown, 0, start, children)
                        }
                        _ => return None,
                    }
                }
                _ => return Some(e),
            };
            self.add_link(&mut count)?;
        }
    }

    /// `calls` is the number of calls that `callee` starts with.
    #[inline]
    pub(super) fn call(
        &mut self,
        start: u32,
        callee: Id,
        type_args: Id,
        flags: u32,
        calls: &mut u32,
    ) -> P {
        let args = self.arguments()?;
        *calls += 1;
        let node = *self.node(callee);
        match node.kind {
            K::Ident if matches!(node.op, T::Require | T::Async) => self.odd(),
            K::Ident => match self.slice((node.start, node.end)) {
                b"define" | b"inject" | b"fakeAsync" | b"waitForAsync" => self.odd(),
                b"graphql" => self.may_have_graphql(args),
                _ => {}
            },
            K::Call => {
                self.flag(callee, flag::ODD);
                self.flag(node.c, flag::ODD);
                self.odd();
            }
            _ => self.odd_if(*calls > 2),
        }
        let id = self.add(
            K::Call,
            T::Unknown,
            flags,
            start,
            [callee, type_args, args, NONE],
        );
        if self.tailwind.is_some() {
            self.check_classes_in_call(id)?;
        }
        Some(id)
    }

    #[cold]
    fn may_have_graphql(&mut self, args: Id) {
        for i in 0..self.node(args).len as usize {
            self.flag(
                self.tree.list(args).get(i).copied().unwrap_or(NONE),
                flag::ODD,
            );
        }
        self.flag(args, flag::ODD);
        self.odd();
    }

    pub(super) fn type_arguments_in_expression(&mut self) -> P {
        let type_args = self.type_arguments()?;
        // `>=` and `>>` don't end the list.
        let next = self.lx.src.get(self.lx.at.prev_end as usize);
        require(!matches!(next, Some(b'=' | b'>')))?;
        Some(type_args)
    }

    /// At a `<` or `<<` after a space. False if it's certain to be an operator.
    fn may_be_type_arguments(&mut self) -> bool {
        let less_than = self.start() as usize;
        let ends_early = self.token() == T::Lt
            && self.look_ahead(|p| {
                for _ in 0..8 {
                    if let Some(answer) = p.ends_type_arguments_early() {
                        return answer;
                    }
                }
                false
            });
        !ends_early && may_have_end_of_type_arguments(self.lx.src, less_than)
    }

    /// At the `<` or a `,`. `None` if a type and another comma follow.
    fn ends_type_arguments_early(&mut self) -> Option<bool> {
        let is_first = self.token() == T::Lt;
        self.next();
        match self.token() {
            T::CloseParen | T::CloseBracket | T::CloseBrace => return Some(!is_first),
            T::Num | T::Str | T::This => self.next(),
            T::Minus if self.peek().0 == T::Num => {
                self.next();
                self.next();
            }
            T::Ident => {
                self.next();
                while self.eat(T::Dot) {
                    if !self.token().is_word() {
                        return Some(false);
                    }
                    self.next();
                }
            }
            _ => return Some(false),
        }
        Some(match self.token() {
            T::Comma => return None,
            T::Question => {
                self.next();
                self.token().is_identifier()
                    || matches!(
                        self.token(),
                        T::Str
                            | T::Num
                            | T::OpenBrace
                            | T::OpenBracket
                            | T::OpenParen
                            | T::Lt
                            | T::This
                            | T::Null
                            | T::True
                            | T::False
                            | T::Minus
                            | T::New
                            | T::Await
                            | T::Template
                            | T::TemplateHead
                    )
            }
            token => matches!(
                token,
                T::AmpAmp
                    | T::BarBar
                    | T::CloseParen
                    | T::CloseBracket
                    | T::CloseBrace
                    | T::Semicolon
                    | T::Colon
                    | T::Eq
                    | T::OpenParen
                    | T::Dot
                    | T::QuestionDot
                    | T::Plus
                    | T::Minus
                    | T::Star
                    | T::Slash
                    | T::Percent
            ),
        })
    }

    #[inline]
    fn member_name(&mut self, chain: u32) -> P {
        match self.token() {
            T::PrivateName if chain == 0 => self.private_name_use(),
            // The parser takes a word on the next line for the start of a statement if another word follows it.
            _ if self.newline_before() => None,
            _ => self.word(),
        }
    }

    fn private_name_use(&mut self) -> P {
        require(self.class_depth > 0)?;
        let name = (self.start(), self.lx.at.end);
        self.buffers.private_uses.push(name);
        Some(self.leaf(K::PrivateName))
    }

    fn index(&mut self, start: u32, object: Id, flags: u32) -> P {
        self.pass(Gap::None, Gap::None);
        let index = self.expression_in_brackets()?;
        require(self.eat_suffix(T::CloseBracket))?;
        Some(self.add(
            K::Index,
            T::Unknown,
            flags,
            start,
            [object, index, NONE, NONE],
        ))
    }

    fn arguments(&mut self) -> P {
        let (start, base) = (self.start(), self.list_base());
        self.pass(Gap::None, Gap::None);
        if self.eat_suffix(T::CloseParen) {
            return Some(self.add1(K::Args, start, NONE));
        }
        let flags = self.in_brackets(|p| p.comma_list(T::CloseParen, Self::element))?;
        self.odd_if(
            self.tree
                .is_function_composition(self.buffers.stack.get(base..)?),
        );
        self.add_list(K::Args, flags, start, base)
    }

    #[inline]
    fn element(&mut self) -> P {
        if self.token() != T::DotDotDot {
            return self.assignment();
        }
        let start = self.start();
        self.pass_prefix();
        let argument = self.spread_argument()?;
        Some(self.add1(K::Spread, start, argument))
    }

    pub(super) fn spread_argument(&mut self) -> P {
        let argument = self.assignment()?;
        self.odd_if(matches!(
            self.kind(argument),
            K::Binary | K::Logical | K::As | K::Satisfies | K::Await | K::Yield | K::Cond
        ));
        Some(argument)
    }

    #[inline]
    fn primary(&mut self) -> P {
        let token = self.token();
        match token {
            T::Ident => Some(self.leaf(K::Ident)),
            T::Str => self.string(),
            T::Num => Some(self.number()),
            T::This => Some(self.leaf(K::This)),
            T::Null => Some(self.leaf(K::Null)),
            T::True | T::False => Some(self.leaf(K::Bool)),
            T::OpenBrace => self.object(),
            T::OpenBracket => self.array(),
            T::OpenParen => self.parenthesized(),
            _ => self.less_common_primary(token),
        }
    }

    fn number(&mut self) -> Id {
        let id = self.leaf(K::Num);
        self.odd_if(matches!(
            self.token(),
            T::Dot | T::QuestionDot | T::OpenBracket
        ));
        id
    }

    fn less_common_primary(&mut self, token: T) -> P {
        let start = self.start();
        match token {
            T::BigInt => Some(self.leaf(K::BigInt)),
            T::Template | T::TemplateHead => self.template(false),
            T::Slash | T::SlashEq => {
                self.lx.rescan_regex();
                require(self.token() == T::Regex && self.lx.wasted < self.budget)?;
                Some(self.leaf(K::Regex))
            }
            T::Function => self.function(start, 0),
            T::Async if self.peek() == (T::Function, false) => {
                self.next();
                self.function(start, flag::ASYNC)
            }
            T::Class => self.class(start, 0),
            T::New => self.new_expression(start),
            T::Lt if self.language.has_jsx => self.jsx_expression(),
            T::Super => {
                let id = self.leaf(K::Super);
                let is_allowed = match self.token() {
                    T::OpenParen => self.has(ctx::SUPER_CALL),
                    T::Dot => self.has(ctx::SUPER_MEMBER) && self.peek().0.is_word(),
                    T::OpenBracket => self.has(ctx::SUPER_MEMBER),
                    _ => false,
                };
                is_allowed.then_some(id)
            }
            T::Import => self.import_expression(start),
            T::Arguments if !self.has(ctx::NO_ARGUMENTS) => Some(self.leaf(K::Ident)),
            _ if token.is_identifier() => Some(self.leaf(K::Ident)),
            _ => None,
        }
    }

    fn parenthesized(&mut self) -> P {
        self.next();
        let (start, token) = (self.start(), self.token());
        let e = self.expression_in_brackets()?;
        self.expect(T::CloseParen)?;
        self.flag(e, flag::PARENS | flag::ODD);
        // What it starts with may need parentheses of its own.
        if matches!(token, T::OpenBrace | T::Function | T::Class | T::Async) {
            let mut left = self.node(e).a;
            while left != NONE && self.node(left).start == start {
                self.flag(left, flag::ODD);
                left = self.node(left).a;
            }
        }
        Some(e)
    }

    fn meta_property(&mut self, start: u32, name: &[u8]) -> P {
        require(self.eat_between(Gap::None, T::Dot, Gap::None))?;
        require(self.slice((self.start(), self.lx.at.end)) == name)?;
        self.next();
        self.is_module_without_module_syntax |= !self.has_module_syntax && name == b"meta";
        let id = self.add1(K::Meta, start, NONE);
        let len = self.node(id).end - start;
        require(matches!((name, len), (b"meta", 11) | (b"target", 10)))?;
        Some(id)
    }

    fn import_expression(&mut self, start: u32) -> P {
        self.next();
        if self.token() != T::OpenParen {
            require(self.language.allows_module_syntax)?;
            return self.meta_property(start, b"meta");
        }
        let args = self.arguments()?;
        let list = self.tree.list(args);
        let is_usual = |&it: &Id| !matches!(self.kind(it), K::Spread | K::Jsx);
        require(matches!(list.len(), 1 | 2) && list.iter().all(is_usual))?;
        Some(self.add(
            K::ImportCall,
            T::Unknown,
            0,
            start,
            [NONE, NONE, args, NONE],
        ))
    }

    fn new_expression(&mut self, start: u32) -> P {
        self.pass_keyword();
        if self.token() == T::Dot {
            require(self.has(ctx::NEW_TARGET))?;
            return self.meta_property(start, b"target");
        }
        require(!matches!(self.token(), T::Import | T::Super | T::Lt))?;
        self.enter()?;
        let callee_start = self.start();
        let head = self.primary()?;
        let callee = self.members_and_calls(callee_start, head, false)?;
        self.leave();
        let type_args = match self.token() == T::Lt && self.start() == self.lx.at.prev_end {
            true => self.type_arguments_in_expression()?,
            false => NONE,
        };
        require(self.token() == T::OpenParen)?;
        let args = self.arguments()?;
        if self.text(callee) == b"graphql" {
            self.may_have_graphql(args);
        }
        Some(self.add(
            K::New,
            T::Unknown,
            0,
            start,
            [callee, type_args, args, NONE],
        ))
    }

    fn template(&mut self, is_tagged: bool) -> P {
        let id = self.template_of(K::Template, is_tagged, Self::expression)?;
        if is_tagged {
            self.flag(id, flag::ODD);
            self.odd();
        }
        Some(id)
    }

    pub(super) fn template_of(
        &mut self,
        kind: K,
        is_tagged: bool,
        substitution: impl Fn(&mut Self) -> P,
    ) -> P {
        let (start, base) = (self.start(), self.list_base());
        let (markup_depth, mut before) = (self.lx.markup_depth, Gap::Open);
        loop {
            require(self.lx.wasted < self.budget)?;
            require(is_tagged || !self.has_escape())?;
            let token = self.token();
            require(matches!(token, T::Template | T::TemplateHead))?;
            let quasi = self.leaf_without_next(K::Quasi);
            self.push(quasi);
            if token == T::Template {
                self.lx.markup_depth = markup_depth;
                self.pass(before, Gap::Open);
                return self.add_list(kind, 0, start, base);
            }
            self.lx.markup_depth = markup_depth + 1;
            self.pass(before, Gap::None);
            before = Gap::None;
            let e = self.in_brackets(&substitution)?;
            self.push(e);
            require(self.token() == T::CloseBrace)?;
            self.lx.rescan_template();
        }
    }

    #[inline(never)]
    fn array(&mut self) -> P {
        let (start, base) = (self.start(), self.list_base());
        self.pass_prefix();
        let flags = self.in_brackets(|p| {
            p.comma_list(T::CloseBracket, |p| match p.token() {
                T::Comma => Some(p.hole()),
                _ => p.element(),
            })
        })?;
        self.odd_if(
            self.tree
                .should_break_array(self.buffers.stack.get(base..)?),
        );
        self.add_list(K::Array, flags, start, base)
    }

    fn hole(&mut self) -> Id {
        self.odd();
        let id = self.leaf_without_next(K::Hole);
        if let Some(node) = self.tree.nodes.get_mut(id as usize) {
            node.end = node.start;
        }
        id
    }

    #[inline(never)]
    fn object(&mut self) -> P {
        let (start, base) = (self.start(), self.list_base());
        self.pass_open_brace();
        let mut has_proto = false;
        let flags = self.in_brackets(|p| {
            p.comma_list(T::CloseBrace, |p| {
                let property = p.property()?;
                let key = p.node(property).a;
                if p.text(key).ends_with(b"__proto__") || p.text(key).get(1..4) == Some(b"__p") {
                    require(!has_proto)?;
                    has_proto = true;
                }
                Some(property)
            })
        })?;
        self.add_list(K::Object, flags, start, base)
    }

    /// Returns the key and `flag::COMPUTED` or 0.
    #[inline]
    pub(super) fn property_key(&mut self) -> P<(Id, u32)> {
        let key = match self.token() {
            T::Str => {
                let key = self.string()?;
                let text = self.text(key);
                self.odd_if(
                    self.style.has_consistent_keys
                        || (!strings::contains_char(text, b'-')
                            && !strings::contains_char(text, b'/')),
                );
                key
            }
            T::Num => self.leaf(K::Num),
            T::OpenBracket => {
                self.pass_prefix();
                let key = self.assignment_in_brackets()?;
                require(self.eat_suffix(T::CloseBracket))?;
                return Some((key, flag::COMPUTED));
            }
            _ => self.word()?,
        };
        Some((key, 0))
    }

    /// At `get`, `set` or `async`. True if the name of a method follows.
    pub(super) fn is_followed_by_key(&mut self) -> P<bool> {
        let (next, is_on_next_line) = self.peek();
        let is_key = next.is_word()
            || matches!(
                next,
                T::Str | T::Num | T::BigInt | T::OpenBracket | T::PrivateName | T::Star
            );
        require(!is_key || !is_on_next_line)?;
        Some(is_key)
    }

    /// `async`, `*`, `get` and `set` before a key. Returns the `op` of the member and the flags of the function.
    pub(super) fn method_prefix(&mut self) -> P<(T, u32)> {
        let (mut op, mut flags) = (T::Unknown, 0);
        let token = self.token();
        if matches!(token, T::Async | T::Get | T::Set) && self.is_followed_by_key()? {
            self.next();
            if token != T::Async {
                return Some((token, 0));
            }
            (op, flags) = (T::OpenParen, flag::ASYNC);
        }
        if self.eat(T::Star) {
            (op, flags) = (T::OpenParen, flags | flag::STAR);
        }
        Some((op, flags))
    }

    fn property(&mut self) -> P {
        let (start, token) = (self.start(), self.token());
        if token == T::DotDotDot {
            return self.element();
        }
        let (op, fn_flags) = match token {
            T::Async | T::Get | T::Set | T::Star => self.method_prefix()?,
            _ => (T::Unknown, 0),
        };
        let token = self.token();
        let (key, flags) = self.property_key()?;
        match self.token() {
            T::Colon if op == T::Unknown => {
                self.pass(Gap::None, Gap::Space);
                let value = self.assignment()?;
                Some(self.add(K::Prop, T::Colon, flags, start, [key, value, NONE, NONE]))
            }
            T::OpenParen | T::Lt => {
                let op = if op == T::Unknown { T::OpenParen } else { op };
                let value = self.method_value(op, fn_flags, ctx::SUPER_MEMBER, Owner::Function)?;
                require(self.node(value).d != NONE)?;
                Some(self.add(K::Prop, op, flags, start, [key, value, NONE, NONE]))
            }
            _ => {
                require(op == T::Unknown && flags == 0 && token.is_identifier())?;
                let mut default = NONE;
                if self.eat(T::Eq) {
                    require(token != T::Eval)?;
                    default = self.assignment()?;
                    self.shorthand_defaults += 1;
                }
                Some(self.add(K::Prop, T::Ident, 0, start, [key, default, NONE, NONE]))
            }
        }
    }

    // ───────────────────────────── functions ─────────────────────────────

    /// At the `function`.
    pub(super) fn function(&mut self, start: u32, mut flags: u32) -> P {
        self.next();
        if self.eat(T::Star) {
            flags |= flag::STAR;
        }
        let name = match self.token() {
            T::OpenParen | T::Lt => NONE,
            _ => self.binding_name()?,
        };
        let id = self.function_rest(start, name, flags, 0, Owner::Function)?;
        if self.node(id).d == NONE {
            let is_plain = flags & (flag::ASYNC | flag::STAR) == 0;
            require(flags & flag::DECLARATION != 0 && is_plain)?;
        }
        Some(id)
    }

    /// At the type parameters or the parameters of a method.
    pub(super) fn method_value(&mut self, op: T, flags: u32, ctx: u32, owner: Owner) -> P {
        let id = self.function_rest(self.start(), NONE, flags, ctx, owner)?;
        self.check_accessor(op, id)?;
        Some(id)
    }

    pub(super) fn check_accessor(&self, op: T, function: Id) -> P<()> {
        let node = self.node(function);
        let params = self.tree.list(node.params());
        require(match (op, params) {
            (T::Get, _) => params.is_empty() && node.b == NONE,
            (T::Set, &[only]) => {
                let param = self.node(only);
                !param.has(flag::REST | flag::OPTIONAL)
                    && self.kind(param.a) != K::This
                    && (param.c == NONE || !self.language.is_typescript)
                    && node.b == NONE
                    && node.c == NONE
            }
            (T::Set, _) => false,
            _ => true,
        })
    }

    fn function_rest(&mut self, start: u32, name: Id, flags: u32, ctx: u32, owner: Owner) -> P {
        let ctx = ctx | ctx::NEW_TARGET | self.ctx & (ctx::FOR_INIT | ctx::AMBIENT);
        let (type_params, params, return_type) =
            self.with(ctx, |p| p.signature(Gap::None, owner))?;
        self.odd();
        let body = match self.token() {
            T::OpenBrace => {
                require(!self.has(ctx::AMBIENT))?;
                self.function_body(ctx, flags, params)?
            }
            _ => {
                self.require_typescript()?;
                let has_value = |&it: &Id| {
                    let param = self.node(it);
                    param.c != NONE
                        || param.has(flag::ACCESSIBILITY | flag::READONLY | flag::OVERRIDE)
                };
                require(!self.tree.list(params).iter().any(has_value))?;
                if flags & flag::DECLARATION != 0 {
                    self.semicolon()?;
                }
                NONE
            }
        };
        let children = [name, type_params, return_type, body];
        Some(self.add_function(K::Fn, T::Unknown, flags, start, children, params))
    }

    pub(super) fn add_function(
        &mut self,
        kind: K,
        op: T,
        flags: u32,
        start: u32,
        children: [Id; 4],
        params: Id,
    ) -> Id {
        let id = self.add(kind, op, flags, start, children);
        self.adopt(params, id);
        if let Some(node) = self.tree.nodes.get_mut(id as usize) {
            node.list = params;
        }
        id
    }

    /// Type parameters, parameters and return type
    pub(super) fn signature(&mut self, before: Gap, owner: Owner) -> P<(Id, Id, Id)> {
        let type_params = self.optional_type_parameters(flag::CONST)?;
        let params = self.parameters(before, owner)?;
        let return_type = match self.eat_separator(T::Colon) {
            true => self.return_type()?,
            false => NONE,
        };
        Some((type_params, params, return_type))
    }

    fn function_body(&mut self, mut ctx: u32, flags: u32, params: Id) -> P {
        ctx |= ctx::RETURN;
        if flags & flag::ASYNC != 0 {
            ctx |= ctx::AWAIT;
        }
        if flags & flag::STAR != 0 {
            ctx |= ctx::YIELD;
        }
        let body = self.with(ctx, |p| p.block_without_labels(K::Body))?;
        let first = self.tree.list(body).first();
        if first.is_some_and(|&it| self.kind(it) == K::Directive) {
            let is_simple = |&it: &Id| {
                let param = self.node(it);
                self.kind(param.a) == K::Ident && param.c == NONE && !param.has(flag::REST)
            };
            require(self.tree.list(params).iter().all(is_simple))?;
        }
        Some(body)
    }

    pub(super) fn parameters(&mut self, before: Gap, owner: Owner) -> P {
        let (start, base) = (self.start(), self.list_base());
        require(self.eat_between(before, T::OpenParen, Gap::None))?;
        let mut before = 0;
        let flags = self.with(self.ctx & !(ctx::NO_IN | ctx::BEFORE_COLON), |p| {
            p.comma_list(T::CloseParen, |p| {
                let is_first = p.list_base() == base;
                let id = p.parameter(owner, is_first)?;
                let param = p.node(id);
                let is_required = !param.has(flag::OPTIONAL | flag::REST) && param.c == NONE;
                require(before & flag::REST == 0)?;
                require(before & flag::OPTIONAL == 0 || !is_required)?;
                before |= param.flags;
                Some(id)
            })
        })?;
        require(flags == 0 || before & flag::REST == 0)?;
        self.add_list(K::Params, flags, start, base)
    }

    fn parameter(&mut self, owner: Owner, is_first: bool) -> P {
        let start = self.start();
        let (mut flags, mut decorators) = (0, NONE);
        if self.token() == T::At {
            self.require_typescript()?;
            require(matches!(owner, Owner::Method | Owner::Constructor))?;
            decorators = self.decorators()?;
            require(self.token() != T::This)?;
        }
        if owner == Owner::Constructor && self.language.is_typescript {
            flags = self.modifiers()?;
            self.odd_if(flags != 0);
            require(flags & !(flag::ACCESSIBILITY | flag::READONLY | flag::OVERRIDE) == 0)?;
            let token = self.token();
            require(flags == 0 || (token.is_identifier() && token != T::Constructor))?;
        }
        if self.eat_between(Gap::Open, T::DotDotDot, Gap::None) {
            flags |= flag::REST;
        }
        let pattern = match self.token() {
            T::This => {
                let is_allowed =
                    matches!(owner, Owner::Function | Owner::Method | Owner::Signature);
                require(is_first && flags == 0 && is_allowed)?;
                self.require_typescript()?;
                let id = self.leaf(K::This);
                require(self.token() == T::Colon)?;
                id
            }
            _ => self.binding_pattern()?,
        };
        if self.eat_suffix(T::Question) {
            self.require_typescript()?;
            require(flags & flag::REST == 0 && self.kind(pattern) == K::Ident)?;
            flags |= flag::OPTIONAL;
        }
        let ty = self.optional_type_annotation()?;
        let mut default = NONE;
        if self.eat_infix(T::Eq) {
            require(flags & (flag::REST | flag::OPTIONAL) == 0)?;
            require(owner != Owner::Signature && self.kind(pattern) != K::This)?;
            default = self.assignment()?;
        }
        Some(self.add(
            K::Param,
            T::Unknown,
            flags,
            start,
            [pattern, ty, default, decorators],
        ))
    }

    pub(super) fn binding_pattern(&mut self) -> P {
        let (kind, close) = match self.token() {
            T::OpenBrace => (K::ObjectPattern, T::CloseBrace),
            T::OpenBracket => (K::ArrayPattern, T::CloseBracket),
            _ => return self.binding_name(),
        };
        self.enter()?;
        let (start, base) = (self.start(), self.list_base());
        match kind {
            K::ObjectPattern => self.pass_open_brace(),
            _ => self.pass_prefix(),
        }
        let mut has_rest = false;
        let flags = self.in_brackets(|p| {
            p.comma_list(close, |p| {
                require(!has_rest)?;
                let start = p.start();
                match (p.token(), kind) {
                    (T::DotDotDot, _) => {
                        has_rest = true;
                        p.pass_prefix();
                        let argument = match kind {
                            K::ObjectPattern => p.binding_name()?,
                            _ => p.binding_pattern()?,
                        };
                        Some(p.add1(K::Rest, start, argument))
                    }
                    (_, K::ObjectPattern) => p.binding_property(),
                    (T::Comma, _) => Some(p.hole()),
                    _ => p.binding_element(),
                }
            })
        })?;
        require(flags == 0 || !has_rest)?;
        self.leave();
        self.add_list(kind, flags, start, base)
    }

    fn binding_element(&mut self) -> P {
        let start = self.start();
        let pattern = self.binding_pattern()?;
        self.with_default(start, pattern)
    }

    fn with_default(&mut self, start: u32, pattern: Id) -> P {
        if !self.eat_infix(T::Eq) {
            return Some(pattern);
        }
        let default = self.assignment()?;
        Some(self.add2(K::AssignPattern, start, pattern, default))
    }

    fn binding_property(&mut self) -> P {
        let (start, token) = (self.start(), self.token());
        let (key, flags) = self.property_key()?;
        if self.eat_separator(T::Colon) {
            let value = self.binding_element()?;
            self.odd_if(matches!(
                self.kind(value),
                K::ObjectPattern | K::ArrayPattern
            ));
            return Some(self.add(
                K::PatternProp,
                T::Colon,
                flags,
                start,
                [key, value, NONE, NONE],
            ));
        }
        require(flags == 0 && token.is_identifier() && token != T::Eval)?;
        let value = self.with_default(start, key)?;
        Some(self.add(
            K::PatternProp,
            T::Ident,
            0,
            start,
            [NONE, value, NONE, NONE],
        ))
    }

    // ───────────────────────────── arrow functions ─────────────────────────────

    /// At a `(`, `<` or `async`. `Some(None)` if this isn't an arrow function.
    fn try_arrow(&mut self, start: u32) -> P<Option<Id>> {
        let snapshot = self.snapshot();
        let mut flags = 0;
        if self.eat_between(Gap::Open, T::Async, Gap::Space) {
            flags = flag::ASYNC;
            let token = self.token();
            if self.newline_before() || !matches!(token, T::OpenParen | T::Lt) {
                if token.is_identifier() && !self.newline_before() && self.peek().0 == T::Arrow {
                    let name = self.leaf(K::Ident);
                    return self.arrow_after_name(start, name, flags).map(Some);
                }
                self.rewind(&snapshot);
                return Some(None);
            }
        }
        let is_generic = self.token() == T::Lt;
        if is_generic && !self.can_be_type_parameters_of_arrow()? {
            self.rewind(&snapshot);
            return Some(None);
        }
        require(self.budget > 0)?;
        let head = self.with(self.ctx & ctx::LEXICAL, |p| {
            p.signature(Gap::Open, Owner::Arrow)
        });
        match head {
            Some(head) if self.token() == T::Arrow => {
                require(
                    head.2 == NONE
                        || !self.has(ctx::BEFORE_COLON)
                        || (head.0 == NONE && self.can_only_be_parameters(head.1)),
                )?;
                if self.style.avoids_arrow_parentheses && self.node(head.1).len == 1 {
                    self.odd_if(self.tree.can_avoid_parentheses(head));
                }
                self.odd_if(self.kind(head.2) == K::FnType);
                self.arrow_body(start, flags, head).map(Some)
            }
            _ => {
                require(!is_generic || !self.language.has_jsx)?;
                require(head.is_none() || self.token() != T::OpenBrace)?;
                self.rewind(&snapshot);
                self.unsure_if(flags != 0);
                Some(None)
            }
        }
    }

    /// `()`, `(a: T`
    fn can_only_be_parameters(&self, params: Id) -> bool {
        self.tree.list(params).first().is_none_or(|&it| {
            let param = self.node(it);
            self.kind(param.a) == K::Ident
                && param.b != NONE
                && !param.has(flag::OPTIONAL | flag::REST)
        })
    }

    fn can_be_type_parameters_of_arrow(&mut self) -> P<bool> {
        let language = self.language;
        if !language.is_typescript {
            return Some(false);
        }
        if !language.has_jsx && !language.reserves_angle_brackets {
            return Some(true);
        }
        self.look_ahead(|p| {
            p.next();
            if p.token() == T::Const {
                return None;
            }
            p.next();
            match p.token() {
                T::Comma => Some(true),
                T::Extends => {
                    p.next();
                    (!matches!(p.token(), T::Eq | T::Gt | T::Slash)).then_some(true)
                }
                T::Eq => None,
                _ => Some(false),
            }
        })
    }

    fn arrow_after_name(&mut self, start: u32, name: Id, flags: u32) -> P {
        let node = *self.node(name);
        let is_name = node.kind == K::Ident && !node.has(flag::PARENS);
        require(is_name && !matches!(node.op, T::Eval | T::Arguments | T::Async))?;
        let base = self.list_base();
        let param = self.add1(K::Param, node.start, name);
        self.push(param);
        let params = self.add(K::Params, T::Ident, 0, node.start, [NONE; 4]);
        self.take_list(params, base)?;
        self.odd_if(!self.style.avoids_arrow_parentheses);
        self.arrow_body(start, flags, (NONE, params, NONE))
    }

    fn arrow_body(&mut self, start: u32, flags: u32, head: (Id, Id, Id)) -> P {
        let (type_params, params, return_type) = head;
        require(!self.newline_before())?;
        self.pass_infix();
        let ctx = self.ctx & ctx::LEXICAL;
        let body = match self.token() {
            T::OpenBrace => {
                let body = self.function_body(ctx, flags, params)?;
                // Only a comma or the end of the expression can follow.
                require(
                    matches!(
                        self.token(),
                        T::Comma
                            | T::CloseParen
                            | T::CloseBracket
                            | T::CloseBrace
                            | T::Semicolon
                            | T::Colon
                            | T::Eof
                    ) || (self.newline_before()
                        && self.token().is_word()
                        && precedence(self.token()) == 0),
                )?;
                body
            }
            _ => {
                let mut ctx = ctx | ctx::RETURN | self.ctx & ctx::UNTIL_BRACKET;
                if flags & flag::ASYNC != 0 {
                    ctx |= ctx::AWAIT;
                }
                let body = self.with(ctx, Self::assignment)?;
                self.odd_if(matches!(self.kind(body), K::Arrow | K::Cond));
                body
            }
        };
        let children = [NONE, type_params, return_type, body];
        Some(self.add_function(K::Arrow, T::Unknown, flags, start, children, params))
    }
}

/// True if a `>` after `less_than` could close it.
fn may_have_end_of_type_arguments(src: &[u8], less_than: usize) -> bool {
    let byte = |at: usize| src.get(at).copied().unwrap_or(0);
    let (mut at, mut depth) = (less_than, 0u32);
    while at < less_than + 600 {
        at += 1;
        match byte(at) {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' | b'}' | b';' | 0 if depth == 0 => return false,
            b')' | b']' | b'}' => depth -= 1,
            b'`' => return true,
            b'/' if matches!(byte(at + 1), b'/' | b'*') => return true,
            quote @ (b'"' | b'\'') => loop {
                at += 1;
                match byte(at) {
                    c if c == quote => break,
                    b'(' | b'[' | b'{' | b')' | b']' | b'}' | b'>' | b';' | b'\\' | 0..0x20 => {
                        return true;
                    }
                    _ => {}
                }
            },
            b'>' if byte(at - 1) == b'=' || matches!(byte(at + 1), b'>' | b'=') => {}
            b'>' => {
                let next = at + 1 + usize::from(byte(at + 1) == b' ');
                let starts_expression = match byte(next) {
                    b'0'..=b'9' | b'A'..=b'Z' | b'_' | b'$' | b'"' | b'\'' | b'[' | b'{' | b'-' => {
                        true
                    }
                    b'a'..=b'z' => super::super::lexer::is_plain_name_at(src, next),
                    _ => false,
                };
                if !starts_expression {
                    return true;
                }
            }
            _ => {}
        }
    }
    true
}
