use super::*;

impl Parser<'_> {
    /// Replaces the tree with that of the next statement of the file.
    pub(in super::super) fn top_level_statement(&mut self, allows_directive: bool) -> P {
        self.tree.clear();
        self.lx.forget_past();
        self.ctx = ctx::MODULE_ITEM;
        if self.language.allows_module_syntax {
            self.ctx |= ctx::AWAIT;
        }
        if self.language.is_declaration_file {
            self.ctx = ctx::MODULE_ITEM | ctx::AMBIENT;
        }
        (self.links, self.may_be_too_high) = (0, false);
        let id = self.list_item(allows_directive)?;
        require(!self.may_be_too_high || !self.is_too_high())?;
        Some(id)
    }

    fn list_item(&mut self, allows_directive: bool) -> P {
        let outer = (self.is_unsure, self.shorthand_defaults);
        (self.is_unsure, self.shorthand_defaults) = (std::mem::take(&mut self.is_after_skipped), 0);
        let before = self.snapshot();
        let id = match self.statement(true) {
            Some(id) if self.shorthand_defaults == 0 => id,
            _ => self.skip_statement(&before)?,
        };
        let node = *self.node(id);
        if node.kind == K::ExprStmt && self.kind(node.a) == K::Str {
            self.flag(id, flag::ODD);
            match allows_directive && !self.node(node.a).has(flag::PARENS) {
                true => self.tree.nodes.get_mut(id as usize)?.kind = K::Directive,
                false => self.unsure(),
            }
        }
        // `"use strict" as any`
        self.unsure_if(
            allows_directive
                && matches!(self.text(id).first(), Some(b'"' | b'\''))
                && self.kind(id) != K::Directive,
        );
        if self.is_unsure {
            self.flag(id, flag::UNSURE);
        }
        (self.is_unsure, self.shorthand_defaults) = outer;
        Some(id)
    }

    /// Goes by the indentation to find the end of the statement at `before`. That's a guess, which is right if the real
    /// parser finds statements in the same places and the file is formatted.
    #[cold]
    fn skip_statement(&mut self, before: &Snapshot) -> P {
        self.rewind(before);
        require(self.budget > 0)?;
        let (src, start) = (self.lx.src, self.start());
        let text_before = src.get(..start as usize)?;
        let line = strings::last_index_of_char(text_before, b'\n').map_or(0, |it| it + 1);
        let indentation = text_before.get(line..)?;
        require(indentation.iter().all(|b| matches!(b, b' ' | b'\t')))?;
        let mut at = start as usize;
        loop {
            at += strings::index_of_char_usize(src.get(at..)?, b'\n')? + 1;
            let rest = src.get(at..)?;
            let has_ended = match rest.strip_prefix(indentation) {
                Some(rest) => rest.first().is_none_or(u8::is_ascii_alphabetic),
                None => rest.first() != Some(&b'\n'),
            };
            if has_ended {
                break;
            }
        }
        let text = src.get(start as usize..at)?.trim_ascii_end();
        self.has_skipped_export |= self.depth == 0
            && strings::contains(text, b"export")
            && (!self.language.is_typescript || strings::contains(text, b"default"));
        self.lx.skip_to(start + text.len() as u32);
        (self.has_skipped, self.is_after_skipped, self.is_unsure) = (true, true, true);
        let id = self.add1(K::Empty, start, NONE);
        self.flag(id, flag::COMMENT);
        Some(id)
    }

    /// Up to a `}`, `case` or `default`.
    fn statements(&mut self, mut allows_directive: bool) -> P<()> {
        while !matches!(self.token(), T::CloseBrace | T::Case | T::Default) {
            let id = self.list_item(allows_directive)?;
            allows_directive &= self.kind(id) == K::Directive;
            self.push(id);
        }
        Some(())
    }

    pub(super) fn block(&mut self, kind: K) -> P {
        let (start, base) = (self.start(), self.list_base());
        self.expect(T::OpenBrace)?;
        self.statements(kind == K::Body)?;
        require(self.eat_suffix(T::CloseBrace))?;
        self.odd_if(kind != K::Body || self.list_base() > base);
        self.is_unsure |= std::mem::take(&mut self.is_after_skipped);
        self.add_list(kind, 0, start, base)
    }

    fn statement(&mut self, is_in_list: bool) -> P {
        self.enter()?;
        let outer = self.ctx;
        self.ctx &= !(ctx::MODULE_ITEM | ctx::CASE_ITEM);
        let id = self.statement_inner(is_in_list, outer)?;
        self.ctx = outer;
        self.leave();
        Some(id)
    }

    fn statement_inner(&mut self, is_in_list: bool, outer: u32) -> P {
        let (start, token) = (self.start(), self.token());
        let is_module_item = outer & ctx::MODULE_ITEM != 0;
        let allows_using = is_in_list
            && outer & ctx::CASE_ITEM == 0
            && (!is_module_item || (self.depth == 1 && self.has_module_syntax));
        if self.has(ctx::AMBIENT) {
            return self.ambient_statement(start, is_module_item);
        }
        match token {
            T::Const | T::Let | T::Var | T::Function | T::Class | T::Enum => {
                require(is_in_list || token == T::Var)?;
                self.declaration(start, 0)
            }
            T::Async if self.peek() == (T::Function, false) => {
                require(is_in_list)?;
                self.declaration(start, 0)
            }
            T::Type | T::Interface | T::Abstract | T::Declare | T::Namespace | T::Module
                if self.is_before_word_or_string() =>
            {
                require(is_in_list)?;
                self.declaration(start, 0)
            }
            T::Using if self.is_before_word_or_string() => {
                require(allows_using)?;
                self.using_declaration(start, token)
            }
            T::Await if self.peek().0 == T::Using => {
                require(allows_using && self.has(ctx::AWAIT))?;
                self.next_on_line()?;
                self.using_declaration(start, token)
            }
            T::Global | T::Component | T::Hook if self.is_before_word_or_string() => None,
            T::Return => {
                require(self.has(ctx::RETURN))?;
                self.pass_keyword();
                let has_ended = matches!(self.token(), T::Semicolon | T::CloseBrace | T::Eof);
                let argument = match has_ended || self.newline_before() {
                    true => NONE,
                    false => self.expression()?,
                };
                self.semicolon()?;
                Some(self.add1(K::Return, start, argument))
            }
            T::If => {
                let test = self.keyword_and_condition()?;
                let yes = self.statement(false)?;
                let no = match self.eat(T::Else) {
                    true => self.statement(false)?,
                    false => NONE,
                };
                self.odd_if(no != NONE);
                Some(self.add(K::If, T::Unknown, 0, start, [test, yes, no, NONE]))
            }
            T::OpenBrace => self.block(K::Block),
            T::For => self.for_statement(start),
            T::While => {
                let test = self.keyword_and_condition()?;
                let body = self.loop_body()?;
                Some(self.add2(K::While, start, test, body))
            }
            T::Do => {
                self.next();
                let body = self.loop_body()?;
                require(self.token() == T::While)?;
                let test = self.keyword_and_condition()?;
                self.semicolon()?;
                Some(self.add2(K::DoWhile, start, body, test))
            }
            T::Throw => {
                self.pass_keyword();
                require(!self.newline_before())?;
                let argument = self.expression()?;
                self.semicolon()?;
                Some(self.add1(K::Throw, start, argument))
            }
            T::Break | T::Continue => {
                let (kind, needs) = match token {
                    T::Break => (K::Break, ctx::BREAK),
                    _ => (K::Continue, ctx::CONTINUE),
                };
                self.pass_keyword();
                let mut label = NONE;
                if self.token() == T::Ident && !self.newline_before() {
                    label = self.leaf(K::Ident);
                    let is_loop = self.find_label(label)?;
                    require(is_loop || kind == K::Break)?;
                }
                require(label != NONE || self.has(needs))?;
                self.semicolon()?;
                Some(self.add1(kind, start, label))
            }
            T::Ident if self.lx.src.get(self.lx.at.end as usize) == Some(&b':') => {
                self.labeled_statement(start)
            }
            T::At => {
                require(is_in_list)?;
                self.decorated_statement(start, is_module_item)
            }
            T::Try => self.try_statement(start),
            T::Switch => self.switch_statement(start),
            T::Debugger => {
                self.next();
                self.semicolon()?;
                Some(self.add1(K::Debugger, start, NONE))
            }
            T::Semicolon => {
                self.unsure_if(is_in_list);
                let id = self.leaf(K::Empty);
                self.odd();
                Some(id)
            }
            T::Export => {
                require(is_module_item && self.language.allows_module_syntax)?;
                self.has_module_syntax |= self.depth == 1;
                self.export(start)
            }
            T::Import if !matches!(self.peek().0, T::OpenParen | T::Dot) => {
                require(is_module_item && self.language.allows_module_syntax)?;
                self.has_module_syntax |= self.depth == 1;
                self.import(start)
            }
            _ => {
                let before = self.lx.at.prev_odd;
                let e = self.expression()?;
                match self.node(e) {
                    node if node.kind == K::Assign && !node.has(flag::ODD) => {
                        self.lx.at.prev_odd = before.max(start);
                    }
                    node => self.odd_if(matches!(node.kind, K::As | K::Satisfies)),
                }
                self.semicolon()?;
                let may_continue_line = !token.is_word() || self.kind(e) == K::Arrow;
                self.odd_if(!self.style.has_semicolons && may_continue_line);
                Some(self.add1(K::ExprStmt, start, e))
            }
        }
    }

    /// Returns whether it labels a loop.
    fn find_label(&self, name: Id) -> P<bool> {
        let labels = self.buffers.labels.get(self.first_label..)?;
        (labels.iter().find(|it| self.slice(it.0) == self.text(name))).map(|it| it.1)
    }

    /// For the body of a function or a static block.
    pub(super) fn block_without_labels(&mut self, kind: K) -> P {
        let outer = std::mem::replace(&mut self.first_label, self.buffers.labels.len());
        let block = self.block(kind);
        self.first_label = outer;
        block
    }

    #[cold]
    fn labeled_statement(&mut self, start: u32) -> P {
        let label = self.leaf(K::Ident);
        require(self.find_label(label).is_none())?;
        self.next();
        let is_loop = matches!(self.token(), T::For | T::While | T::Do);
        require(is_loop || matches!(self.token(), T::OpenBrace | T::If | T::Switch | T::Try))?;
        (self.buffers.labels).push(((start, self.node(label).end), is_loop));
        let body = self.statement(false);
        self.buffers.labels.pop();
        self.odd();
        Some(self.add2(K::Labeled, start, label, body?))
    }

    #[cold]
    fn decorated_statement(&mut self, start: u32, is_module_item: bool) -> P {
        let decorators = self.decorators()?;
        let statement = match self.token() {
            T::Class | T::Abstract => self.declaration(self.start(), 0)?,
            T::Export => {
                require(is_module_item && self.language.allows_module_syntax)?;
                self.has_module_syntax |= self.depth == 1;
                let export = self.export(self.start())?;
                let class = self.node(self.node(export).a);
                require(class.kind == K::Class && class.has(flag::DECLARATION))?;
                require(!class.has(flag::DECLARE))?;
                export
            }
            _ => return None,
        };
        Some(self.add2(K::Decorated, start, decorators, statement))
    }

    fn ambient_statement(&mut self, start: u32, is_module_item: bool) -> P {
        require(is_module_item)?;
        let is_top_level = self.depth == 1;
        match self.token() {
            T::Export => self.export(start),
            T::Import => self.import(start),
            T::Interface | T::Type => self.declaration(start, 0),
            T::Declare if is_top_level => self.declaration(start, 0),
            T::Declare => None,
            _ if is_top_level => None,
            _ => self.declaration(start, 0),
        }
    }

    fn is_before_word_or_string(&mut self) -> bool {
        let (next, _) = self.peek();
        next.is_word() || matches!(next, T::Str | T::OpenBrace)
    }

    fn keyword_and_condition(&mut self) -> P {
        self.pass_keyword();
        require(self.eat_between(Gap::Space, T::OpenParen, Gap::None))?;
        let test = self.expression_in_brackets()?;
        require(self.eat_separator(T::CloseParen))?;
        Some(test)
    }

    fn loop_body(&mut self) -> P {
        self.with(self.ctx | ctx::BREAK | ctx::CONTINUE, |p| {
            p.statement(false)
        })
    }

    /// Moves on to a token that has to be on the same line.
    fn next_on_line(&mut self) -> P<()> {
        self.pass_keyword();
        require(!self.newline_before())
    }

    fn declaration(&mut self, start: u32, flags: u32) -> P {
        let token = self.token();
        match token {
            T::Const if self.peek().0 == T::Enum => {
                self.next();
                self.enum_declaration(start, flags | flag::CONST)
            }
            T::Const | T::Let | T::Var => {
                let base = self.list_base();
                self.declarators(false)?;
                self.semicolon()?;
                let id = self.add(K::Var, token, flags, start, [NONE; 4]);
                self.take_list(id, base)
            }
            T::Async | T::Function => {
                let mut flags = flags | flag::DECLARATION;
                if token == T::Async {
                    flags |= flag::ASYNC;
                    self.next_on_line()?;
                    require(self.token() == T::Function)?;
                }
                let id = self.function(start, flags)?;
                require(self.node(id).a != NONE)?;
                Some(id)
            }
            T::Class | T::Abstract => {
                let mut flags = flags | flag::DECLARATION;
                if token == T::Abstract {
                    flags |= flag::ABSTRACT;
                    self.require_typescript()?;
                    self.next_on_line()?;
                    require(self.token() == T::Class)?;
                }
                let id = self.class(start, flags)?;
                require(self.node(id).a != NONE)?;
                Some(id)
            }
            T::Enum => self.enum_declaration(start, flags),
            T::Type => self.type_alias(start, flags),
            T::Interface => self.interface(start, flags),
            T::Namespace | T::Module => self.module_declaration(start, flags),
            T::Global if flags & flag::DECLARE != 0 => self.module_declaration(start, flags),
            T::Declare if flags & flag::DECLARE == 0 => {
                self.require_typescript()?;
                require(self.depth == 1)?;
                self.next_on_line()?;
                self.with(ctx::AMBIENT, |p| {
                    p.declaration(start, flags | flag::DECLARE)
                })
            }
            _ => None,
        }
    }

    /// At the `using`. `keyword` is the first token.
    fn using_declaration(&mut self, start: u32, keyword: T) -> P {
        let base = self.list_base();
        loop {
            self.next_on_line()?;
            let start = self.start();
            require(matches!(
                self.token(),
                T::Ident | T::Get | T::Set | T::Out | T::Hook
            ))?;
            let name = self.leaf(K::Ident);
            let ty = self.optional_type_annotation()?;
            require(self.eat_infix(T::Eq))?;
            let value = self.assignment()?;
            let id = self.add(K::Declarator, T::Unknown, 0, start, [name, ty, value, NONE]);
            self.push(id);
            if self.token() != T::Comma {
                break;
            }
            self.unsure();
        }
        self.semicolon()?;
        let id = self.add(K::Var, keyword, 0, start, [NONE; 4]);
        self.take_list(id, base)
    }

    /// At the `var`, `let` or `const`.
    fn declarators(&mut self, is_in_for: bool) -> P<()> {
        let keyword = self.token();
        self.pass_keyword();
        loop {
            let start = self.start();
            let pattern = self.binding_pattern()?;
            let is_name = self.kind(pattern) == K::Ident;
            let mut flags = 0;
            if self.token() == T::Bang && !self.newline_before() {
                require(is_name && !is_in_for && keyword != T::Const)?;
                require(!self.has(ctx::AMBIENT))?;
                self.next();
                require(self.token() == T::Colon)?;
                flags = flag::DEFINITE;
            }
            let ty = self.optional_type_annotation()?;
            let mut value = NONE;
            if self.eat_infix(T::Eq) {
                require(flags == 0 && !self.has(ctx::AMBIENT))?;
                value = self.assignment()?;
            } else if self.has(ctx::AMBIENT) {
                require(is_name)?;
            } else if keyword == T::Const || !is_name {
                require(is_in_for && matches!(self.token(), T::In | T::Of))?;
            }
            let id = self.add(
                K::Declarator,
                T::Unknown,
                flags,
                start,
                [pattern, ty, value, NONE],
            );
            self.push(id);
            if !self.eat(T::Comma) {
                return Some(());
            }
        }
    }

    fn for_statement(&mut self, start: u32) -> P {
        self.next();
        let mut flags = 0;
        if self.eat(T::Await) {
            require(self.has(ctx::RETURN) || self.has_module_syntax)?;
            require(self.has(ctx::AWAIT))?;
            flags = flag::ASYNC;
        }
        self.expect(T::OpenParen)?;
        let (init_start, first) = (self.start(), self.token());
        let init = self.with(self.ctx | ctx::NO_IN | ctx::FOR_INIT, |p| match first {
            T::Semicolon => Some(NONE),
            T::Const | T::Let | T::Var => {
                let base = p.list_base();
                p.declarators(true)?;
                let id = p.add(K::Var, first, 0, init_start, [NONE; 4]);
                p.take_list(id, base)
            }
            T::Async | T::Using | T::Await | T::Of => None,
            _ => p.expression(),
        })?;
        let token = self.token();
        if matches!(token, T::In | T::Of) {
            match (self.kind(init), self.tree.list(init)) {
                (K::Var, &[only]) => {
                    require(self.node(only).b == NONE && self.node(only).c == NONE)?;
                    let is_name = self.kind(self.node(only).a) == K::Ident;
                    require(token == T::Of || is_name)?;
                }
                (K::Var, _) => return None,
                _ => {
                    self.to_target(init)?;
                    let is_plain = matches!(self.kind(init), K::Ident | K::Dot);
                    self.unsure_if(!is_plain);
                }
            }
            self.next();
            let (kind, right) = match token {
                T::Of => (K::ForOf, self.assignment()?),
                _ => (K::ForIn, self.expression()?),
            };
            require(flags == 0 || kind == K::ForOf)?;
            self.expect(T::CloseParen)?;
            let body = self.loop_body()?;
            return Some(self.add(kind, T::Unknown, flags, start, [init, right, body, NONE]));
        }
        require(flags == 0)?;
        self.expect(T::Semicolon)?;
        let test = match self.token() {
            T::Semicolon => NONE,
            _ => self.expression()?,
        };
        self.expect(T::Semicolon)?;
        let update = match self.token() {
            T::CloseParen => NONE,
            _ => self.expression()?,
        };
        self.expect(T::CloseParen)?;
        let body = self.loop_body()?;
        Some(self.add(K::For, T::Unknown, 0, start, [init, test, update, body]))
    }

    fn try_statement(&mut self, start: u32) -> P {
        self.next();
        let block = self.block(K::Block)?;
        let (mut handler, mut finalizer) = (NONE, NONE);
        let catch_start = self.start();
        if self.eat(T::Catch) {
            let mut param = NONE;
            if self.eat(T::OpenParen) {
                let start = self.start();
                let pattern = self.binding_pattern()?;
                let ty = self.optional_type_annotation()?;
                require(ty == NONE || matches!(self.node(ty).op, T::Any | T::UnknownWord))?;
                param = self.add2(K::Param, start, pattern, ty);
                self.expect(T::CloseParen)?;
            }
            let body = self.block(K::Block)?;
            handler = self.add2(K::Catch, catch_start, param, body);
        }
        if self.eat(T::Finally) {
            finalizer = self.block(K::Block)?;
        }
        require(handler != NONE || finalizer != NONE)?;
        Some(self.add(
            K::Try,
            T::Unknown,
            0,
            start,
            [block, handler, finalizer, NONE],
        ))
    }

    fn switch_statement(&mut self, start: u32) -> P {
        let discriminant = self.keyword_and_condition()?;
        self.expect(T::OpenBrace)?;
        let (base, mut has_default) = (self.list_base(), false);
        while !self.eat(T::CloseBrace) {
            let start = self.start();
            let test = match self.eat(T::Default) {
                true => {
                    require(!std::mem::replace(&mut has_default, true))?;
                    NONE
                }
                false => {
                    self.expect(T::Case)?;
                    self.with(self.ctx | ctx::BEFORE_COLON, Self::expression)?
                }
            };
            self.expect(T::Colon)?;
            let base = self.list_base();
            self.with(self.ctx | ctx::BREAK | ctx::CASE_ITEM, |p| {
                p.statements(false)
            })?;
            let case = self.add1(K::Case, start, test);
            self.take_list(case, base)?;
            self.push(case);
        }
        let id = self.add1(K::Switch, start, discriminant);
        self.take_list(id, base)
    }

    // ───────────────────────────── modules ─────────────────────────────

    fn source(&mut self) -> P {
        require(self.eat_infix(T::From))?;
        self.string()
    }

    /// Adds an import or export, after its source.
    fn end_with_attributes(
        &mut self,
        kind: K,
        op: T,
        flags: u32,
        start: u32,
        children: [Id; 4],
    ) -> P {
        let base = self.list_base();
        if self.token() == T::With && !self.newline_before() {
            require(flags == 0)?;
            self.next();
            self.expect(T::OpenBrace)?;
            self.expect(T::Type)?;
            self.expect(T::Colon)?;
            let value = self.string()?;
            self.push(value);
            self.expect(T::CloseBrace)?;
            self.odd();
        }
        self.semicolon()?;
        let id = self.add(kind, op, flags, start, children);
        self.take_list(id, base)
    }

    fn import(&mut self, start: u32) -> P {
        self.pass_keyword();
        let (mut flags, mut default, mut namespace, mut specifiers) = (0, NONE, NONE, NONE);
        if self.token() == T::Str {
            let source = self.string()?;
            let children = [NONE, NONE, NONE, source];
            return self.end_with_attributes(K::Import, T::Str, 0, start, children);
        }
        if self.token() == T::Type {
            self.require_typescript()?;
            self.pass_keyword();
            require(!matches!(self.token(), T::From | T::Comma | T::Eq))?;
            flags = flag::TYPE_ONLY;
        }
        if !matches!(self.token(), T::OpenBrace | T::Star) {
            default = self.binding_name()?;
        }
        if default == NONE || (flags == 0 && self.eat_separator(T::Comma)) {
            if self.eat(T::Star) {
                require(self.eat_infix(T::As))?;
                namespace = self.binding_name()?;
            } else {
                specifiers = self.specifiers(true, flags)?;
                self.odd_if(default != NONE && self.node(specifiers).len == 0);
            }
        }
        let source = self.source()?;
        let children = [default, namespace, specifiers, source];
        self.end_with_attributes(K::Import, T::Unknown, flags, start, children)
    }

    fn specifiers(&mut self, is_import: bool, outer_flags: u32) -> P {
        let (start, base) = (self.start(), self.list_base());
        require(self.token() == T::OpenBrace)?;
        self.pass_open_brace();
        let flags = self.comma_list(T::CloseBrace, |p| {
            let (start, mut flags) = (p.start(), 0);
            if p.token() == T::Type && p.peek().0.is_word() {
                p.pass_keyword();
                require(outer_flags == 0 && p.token() != T::As)?;
                p.require_typescript()?;
                flags = flag::TYPE_ONLY;
            }
            let token = p.token();
            let name = p.word()?;
            let alias = match p.eat_infix(T::As) {
                true if is_import => p.binding_name()?,
                true => p.word()?,
                false => NONE,
            };
            let is_binding = token.is_identifier() && token != T::Eval;
            require(!is_import || alias != NONE || is_binding)?;
            Some(p.add(K::Specifier, token, flags, start, [name, alias, NONE, NONE]))
        })?;
        self.add_list(K::Specifiers, flags, start, base)
    }

    fn export(&mut self, start: u32) -> P {
        self.pass_keyword();
        let mut flags = 0;
        if self.token() == T::Type && matches!(self.peek().0, T::OpenBrace | T::Star) {
            self.require_typescript()?;
            self.pass_keyword();
            flags = flag::TYPE_ONLY;
        }
        match self.token() {
            T::Star => {
                require(self.depth == 1)?;
                self.next();
                let name = match self.eat_infix(T::As) {
                    true => self.word()?,
                    false => NONE,
                };
                self.exported(name)?;
                let source = self.source()?;
                self.semicolon()?;
                Some(self.add(
                    K::ExportAll,
                    T::Unknown,
                    flags,
                    start,
                    [name, NONE, NONE, source],
                ))
            }
            T::OpenBrace => {
                require(self.depth == 1)?;
                let specifiers = self.specifiers(false, flags)?;
                let source = match self.token() {
                    T::From => self.source()?,
                    _ => NONE,
                };
                self.semicolon()?;
                for i in 0..self.node(specifiers).len as usize {
                    let it = *self.node(*self.tree.list(specifiers).get(i)?);
                    require(source != NONE || it.op.is_identifier())?;
                    self.exported(if it.b == NONE { it.a } else { it.b })?;
                }
                let children = [NONE, NONE, specifiers, source];
                Some(self.add(K::ExportNamed, T::Unknown, flags, start, children))
            }
            T::Default => {
                require(self.depth == 1 && !self.has(ctx::AMBIENT))?;
                require(!std::mem::replace(&mut self.has_default_export, true))?;
                self.next();
                let value = self.default_export()?;
                Some(self.add1(K::ExportDefault, start, value))
            }
            _ => {
                let declaration = self.declaration(self.start(), 0)?;
                let node = *self.node(declaration);
                match node.kind {
                    _ if self.language.is_typescript => {}
                    K::Var => {
                        for i in 0..node.len as usize {
                            let declarator = *self.tree.list_of(&node).get(i)?;
                            self.exported(self.node(declarator).a)?;
                        }
                    }
                    _ => self.exported(node.a)?,
                }
                require(node.kind != K::Module || node.op == T::Namespace)?;
                Some(self.add1(K::Export, start, declaration))
            }
        }
    }

    fn default_export(&mut self) -> P {
        let start = self.start();
        match self.token() {
            T::Function => self.function(start, flag::DECLARATION),
            T::Async if self.peek() == (T::Function, false) => {
                self.next();
                self.function(start, flag::DECLARATION | flag::ASYNC)
            }
            T::Class => self.class(start, flag::DECLARATION),
            T::Abstract | T::Interface if self.peek().0.is_word() => self.declaration(start, 0),
            _ => {
                let e = self.assignment()?;
                self.semicolon()?;
                Some(e)
            }
        }
    }

    fn exported(&mut self, id: Id) -> P<()> {
        let node = *self.node(id);
        match node.kind {
            K::Ident if node.op == T::Default => {
                require(!std::mem::replace(&mut self.has_default_export, true))?;
            }
            K::Ident if !self.language.is_typescript => {
                self.buffers.exports.push((node.start, node.end));
            }
            K::ObjectPattern | K::ArrayPattern => {
                for i in 0..node.len as usize {
                    let item = *self.tree.list_of(&node).get(i)?;
                    self.exported(item)?;
                }
            }
            K::PatternProp => self.exported(node.b)?,
            K::AssignPattern | K::Rest => self.exported(node.a)?,
            _ => {}
        }
        Some(())
    }

    // ───────────────────────────── TypeScript ─────────────────────────────

    fn type_alias(&mut self, start: u32, flags: u32) -> P {
        self.require_typescript()?;
        self.next_on_line()?;
        let name = self.type_name()?;
        let type_params = self.optional_type_parameters(flag::IN | flag::OUT)?;
        require(self.eat_infix(T::Eq))?;
        require(self.token() != T::Intrinsic)?;
        let ty = self.ty()?;
        self.semicolon()?;
        Some(self.add(
            K::TypeAlias,
            T::Unknown,
            flags,
            start,
            [name, type_params, ty, NONE],
        ))
    }

    fn interface(&mut self, start: u32, flags: u32) -> P {
        self.require_typescript()?;
        self.next_on_line()?;
        let name = self.type_name()?;
        let type_params = self.optional_type_parameters(flag::IN | flag::OUT)?;
        let base = self.list_base();
        if self.token() == T::Extends {
            self.heritage()?;
        }
        let body = self.type_members(K::TypeBody)?;
        let id = self.add(
            K::Interface,
            T::Unknown,
            flags,
            start,
            [name, type_params, body, NONE],
        );
        self.take_list(id, base)
    }

    fn enum_declaration(&mut self, start: u32, flags: u32) -> P {
        self.require_typescript()?;
        self.next();
        let name = self.type_name()?;
        let base = self.list_base();
        self.expect(T::OpenBrace)?;
        let mut needs_value = false;
        let list_flags = self.with(0, |p| {
            p.comma_list(T::CloseBrace, |p| {
                let start = p.start();
                let name = match p.token() {
                    T::Str => {
                        let name = p.string()?;
                        let first = p.text(name).get(1).copied().unwrap_or(0);
                        require(first.is_ascii_alphabetic() && !matches!(first, b'I' | b'N'))?;
                        name
                    }
                    _ => p.word()?,
                };
                let value = match p.eat(T::Eq) {
                    true => p.assignment()?,
                    false => NONE,
                };
                require(value != NONE || !needs_value)?;
                needs_value = !matches!(p.kind(value), K::None | K::Num);
                Some(p.add2(K::EnumMember, start, name, value))
            })
        })?;
        let id = self.add(
            K::Enum,
            T::Unknown,
            flags | list_flags,
            start,
            [name, NONE, NONE, NONE],
        );
        self.take_list(id, base)
    }

    fn module_declaration(&mut self, start: u32, flags: u32) -> P {
        self.require_typescript()?;
        let keyword = self.token();
        let name = match keyword {
            T::Global => {
                self.next();
                NONE
            }
            T::Module => {
                require(flags & flag::DECLARE != 0)?;
                self.next_on_line()?;
                self.string()?
            }
            _ => {
                require(!self.has(ctx::RETURN | ctx::BREAK))?;
                self.next_on_line()?;
                self.type_name()?
            }
        };
        let ctx = self.ctx & ctx::AMBIENT | ctx::MODULE_ITEM;
        let body = self.with(ctx, |p| p.block(K::ModuleBlock))?;
        Some(self.add(K::Module, keyword, flags, start, [name, body, NONE, NONE]))
    }
}
