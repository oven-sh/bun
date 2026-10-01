impl<'a, const TS: bool> P<'a, TS> {
    #[inline]
    pub fn skip_return_type(&mut self) -> Result<(), Error> {
        self.skip_type_with_opts::<Discard>(Level::Lowest, 2, &mut ())
    }

    #[inline]
    pub fn skip_type(&mut self, level: Level) -> Result<(), Error> {
        self.skip_type_with_opts::<Discard>(level, 0, &mut ())
    }

    #[inline]
    pub fn skip_type_with_metadata(&mut self, level: Level) -> Result<Metadata, Error> {
        let mut result = Metadata::default();
        self.skip_type_with_opts::<DecoratorMetadata>(level, 0, &mut result)?;
        Ok(result)
    }

    #[inline(never)]
    fn find_symbol(&mut self, name: &'a [u8]) -> Result<Ref, Error> {
        if name.is_empty() {
            return Err(Error::Syntax);
        }
        self.names.push(name);
        Ok(Ref(self.names.len() as u32 - 1))
    }

    fn load_name_from_ref(&self, r: Ref) -> &'a [u8] {
        self.names[r.0 as usize]
    }

    pub fn skip_binding(&mut self) -> Result<(), Error> {
        if self.depth > 1000 {
            return Err(Error::StackOverflow);
        }
        match self.lexer.token {
            T::Ident => {
                self.lexer.next()?;
            }
            T::OpenBracket => {
                self.lexer.next()?;
                while self.lexer.token != T::CloseBracket {
                    if self.lexer.token == T::DotDotDot {
                        self.lexer.next()?;
                    }
                    self.depth += 1;
                    self.skip_binding()?;
                    self.depth -= 1;
                    if self.lexer.token != T::Comma {
                        break;
                    }
                    self.lexer.next()?;
                }
                self.lexer.expect(T::CloseBracket)?;
            }
            _ => {
                self.lexer.unexpected()?;
                return Err(Error::Syntax);
            }
        }
        Ok(())
    }

    pub fn skip_fn_args<N: PartSink>(&mut self) -> Result<N::Params, Error> {
        let mut params = N::Params::default();
        self.lexer.expect(T::OpenParen)?;
        while self.lexer.token != T::CloseParen {
            if self.lexer.token == T::DotDotDot {
                self.lexer.next()?;
            }
            let name = self.lexer.identifier;
            let name_start = N::start(&self.lexer);
            let name_end = N::end(&self.lexer);
            self.skip_binding()?;
            if self.lexer.token == T::Question {
                self.lexer.next()?;
            }
            let mut ty = N::Out::default();
            if self.lexer.token == T::Colon {
                self.lexer.next()?;
                self.skip_type_with_opts::<N>(Level::Lowest, 0, &mut ty)?;
            }
            N::push_param(&mut params, name, name_start, name_end, ty, self.arena);
            if self.lexer.token != T::Comma {
                break;
            }
            self.lexer.next()?;
        }
        self.lexer.expect(T::CloseParen)?;
        Ok(params)
    }

    pub fn skip_paren_or_fn_type<S: TypeSink>(&mut self, out: &mut S::Out) -> Result<(), Error> {
        let start = S::Nested::start(&self.lexer);
        let (is_fn, params) = S::Nested::split(self.try_skip_arrow_args_with_backtracking::<S::Nested>());
        if is_fn {
            let mut ret = NestedOut::<S>::default();
            self.skip_type_with_opts::<S::Nested>(Level::Lowest, 2, &mut ret)?;
            S::function_type(out);
            S::function_parts(out, params, ret, start, self.arena);
        } else {
            self.lexer.expect(T::OpenParen)?;
            let mut inner = S::Out::default();
            self.skip_type_with_opts::<S>(Level::Lowest, 0, &mut inner)?;
            S::parenthesized(out, self.arena, inner);
            let end = S::Nested::end(&self.lexer);
            self.lexer.expect(T::CloseParen)?;
            S::span(out, start, end);
        }
        Ok(())
    }

    pub fn skip_type_with_opts<S: TypeSink>(&mut self, level: Level, opts: u8, out: &mut S::Out) -> Result<(), Error> {
        if self.depth > 1000 {
            return Err(Error::StackOverflow);
        }
        self.depth += 1;

        loop {
            match self.lexer.token {
                T::Number => {
                    let start = S::Nested::start(&self.lexer);
                    let end = S::Nested::end(&self.lexer);
                    self.lexer.next()?;
                    S::literal(out, TypeLiteral::Number);
                    S::span(out, start, end);
                }
                T::Str => {
                    let start = S::Nested::start(&self.lexer);
                    let end = S::Nested::end(&self.lexer);
                    self.lexer.next()?;
                    S::literal(out, TypeLiteral::String);
                    S::span(out, start, end);
                }
                T::Void => {
                    let start = S::Nested::start(&self.lexer);
                    let end = S::Nested::end(&self.lexer);
                    self.lexer.next()?;
                    S::keyword(out, TypeKeyword::Void);
                    S::span(out, start, end);
                }
                T::Amp | T::Bar => {
                    S::leading_operator(out, self.lexer.token == T::Bar, S::Nested::start(&self.lexer));
                    self.lexer.next()?;
                    continue;
                }
                T::OpenParen => {
                    self.skip_paren_or_fn_type::<S>(out)?;
                }
                T::Ident => {
                    let mut check_type_parameters = true;
                    let start = S::Nested::start(&self.lexer);
                    let end = S::Nested::end(&self.lexer);
                    if self.lexer.identifier == b"any" {
                        self.lexer.next()?;
                        check_type_parameters = false;
                        S::keyword(out, TypeKeyword::Any);
                    } else {
                        S::reference(out, self.arena, self.lexer.identifier, |name| self.find_symbol(name))?;
                        self.lexer.next()?;
                    }
                    S::span(out, start, end);
                    if check_type_parameters && !self.lexer.has_newline_before {
                        let (_, args) = S::Nested::split(self.skip_type_arguments::<S::Nested>()?);
                        S::type_arguments(out, args, self.arena);
                    }
                }
                T::Typeof => {
                    let start = S::Nested::start(&self.lexer);
                    self.lexer.next()?;
                    S::typeof_query(out);
                    if !self.lexer.is_identifier_or_keyword() {
                        self.lexer.expected(T::Ident)?;
                    }
                    let mut end = S::Nested::end(&self.lexer);
                    self.lexer.next()?;
                    while self.lexer.token == T::Dot {
                        self.lexer.next()?;
                        if !self.lexer.is_identifier_or_keyword() {
                            self.lexer.expected(T::Ident)?;
                        }
                        end = S::Nested::end(&self.lexer);
                        self.lexer.next()?;
                    }
                    S::span(out, start, end);
                    if !self.lexer.has_newline_before {
                        let (_, args) = S::Nested::split(self.skip_type_arguments::<S::Nested>()?);
                        S::type_arguments(out, args, self.arena);
                    }
                }
                T::OpenBracket => {
                    let start = S::Nested::start(&self.lexer);
                    self.lexer.next()?;
                    S::tuple_type(out);
                    let mut elements = Types::<S>::default();
                    while self.lexer.token != T::CloseBracket {
                        if self.lexer.token == T::DotDotDot {
                            self.lexer.next()?;
                        }
                        let mut element = NestedOut::<S>::default();
                        self.skip_type_with_opts::<S::Nested>(Level::Lowest, 1, &mut element)?;
                        if self.lexer.token == T::Question {
                            self.lexer.next()?;
                        }
                        if self.lexer.token == T::Colon {
                            self.lexer.next()?;
                            element = NestedOut::<S>::default();
                            self.skip_type_with_opts::<S::Nested>(Level::Lowest, 0, &mut element)?;
                        }
                        S::Nested::push_type(&mut elements, &mut element, self.arena);
                        if self.lexer.token != T::Comma {
                            break;
                        }
                        self.lexer.next()?;
                    }
                    let end = S::Nested::end(&self.lexer);
                    self.lexer.expect(T::CloseBracket)?;
                    S::tuple_elements(out, elements, self.arena);
                    S::span(out, start, end);
                }
                T::OpenBrace => {
                    let start = S::Nested::start(&self.lexer);
                    let members = self.skip_object_type::<S::Nested>()?;
                    S::object_type(out);
                    S::object_members(out, members, start, self.arena);
                }
                _ => {
                    self.lexer.unexpected()?;
                }
            }
            break;
        }

        loop {
            match self.lexer.token {
                T::Bar => {
                    if level >= Level::BitwiseOr {
                        self.depth -= 1;
                        return Ok(());
                    }
                    self.lexer.next()?;
                    match S::union_left(out, |r| self.load_name_from_ref(r)) {
                        Operand::Decided => self.skip_type_with_opts::<Discard>(Level::BitwiseOr, opts, &mut ())?,
                        Operand::Open(left) => {
                            self.skip_type_with_opts::<S>(Level::BitwiseOr, opts, out)?;
                            S::union_right(out, self.arena, left);
                        }
                    }
                }
                T::Excl => {
                    if self.lexer.has_newline_before {
                        self.depth -= 1;
                        return Ok(());
                    }
                    S::end_at(out, S::Nested::end(&self.lexer));
                    self.lexer.next()?;
                }
                T::Dot => {
                    self.lexer.next()?;
                    if !self.lexer.is_identifier_or_keyword() {
                        self.lexer.expect(T::Ident)?;
                    }
                    let is_name = self.lexer.is_identifier_or_keyword();
                    S::member(out, self.arena, self.lexer.identifier, is_name, |name| self.find_symbol(name))?;
                    S::end_at(out, S::Nested::end(&self.lexer));
                    self.lexer.next()?;
                    if !self.lexer.has_newline_before {
                        let (_, args) = S::Nested::split(self.skip_type_arguments::<S::Nested>()?);
                        S::type_arguments(out, args, self.arena);
                    }
                }
                T::OpenBracket => {
                    if self.lexer.has_newline_before {
                        self.depth -= 1;
                        return Ok(());
                    }
                    self.lexer.next()?;
                    let mut skipped = false;
                    let mut index = NestedOut::<S>::default();
                    if self.lexer.token != T::CloseBracket {
                        skipped = true;
                        self.skip_type_with_opts::<S::Nested>(Level::Lowest, 0, &mut index)?;
                    }
                    let end = S::Nested::end(&self.lexer);
                    self.lexer.expect(T::CloseBracket)?;
                    S::index_type(out, index, self.arena);
                    S::index_or_array(out, self.arena, skipped);
                    S::end_at(out, end);
                }
                T::Extends => {
                    if self.lexer.has_newline_before || opts & 4 != 0 {
                        self.depth -= 1;
                        return Ok(());
                    }
                    self.lexer.next()?;
                    {
                        let mut extends_out = S::Out::default();
                        self.skip_type_with_opts::<S>(Level::Lowest, 4, &mut extends_out)?;
                        S::conditional_extends(out, &mut extends_out, self.arena);
                    }
                    self.lexer.expect(T::Question)?;
                    let mut when_true = S::Out::default();
                    self.skip_type_with_opts::<S>(Level::Lowest, 0, &mut when_true)?;
                    self.lexer.expect(T::Colon)?;
                    match S::conditional_true(out, when_true, |r| self.load_name_from_ref(r)) {
                        Operand::Decided => self.skip_type(Level::Lowest)?,
                        Operand::Open(left) => {
                            self.skip_type_with_opts::<S>(Level::Lowest, 0, out)?;
                            S::conditional_false(out, left);
                        }
                    }
                }
                _ => {
                    self.depth -= 1;
                    return Ok(());
                }
            }
        }
    }

    pub fn skip_object_type<N: PartSink>(&mut self) -> Result<N::Members, Error> {
        let mut members = N::Params::default();
        self.lexer.expect(T::OpenBrace)?;
        while self.lexer.token != T::CloseBrace {
            let mut found_key = false;
            let mut name = self.lexer.identifier;
            let mut name_start = N::start(&self.lexer);
            let mut name_end = N::end(&self.lexer);
            while self.lexer.is_identifier_or_keyword() || self.lexer.token == T::Str || self.lexer.token == T::Number {
                name = self.lexer.identifier;
                name_start = N::start(&self.lexer);
                name_end = N::end(&self.lexer);
                self.lexer.next()?;
                found_key = true;
            }
            if found_key && self.lexer.token == T::Question {
                self.lexer.next()?;
            }
            let mut ty = N::Out::default();
            match self.lexer.token {
                T::Colon => {
                    if !found_key {
                        self.lexer.expect(T::Ident)?;
                    }
                    self.lexer.next()?;
                    self.skip_type_with_opts::<N>(Level::Lowest, 0, &mut ty)?;
                }
                T::OpenParen => {
                    let _params = self.skip_fn_args::<N>()?;
                    if self.lexer.token == T::Colon {
                        self.lexer.next()?;
                        self.skip_type_with_opts::<N>(Level::Lowest, 2, &mut ty)?;
                    }
                }
                _ => {
                    if !found_key {
                        self.lexer.unexpected()?;
                        return Err(Error::Syntax);
                    }
                }
            }
            N::push_param(&mut members, name, name_start, name_end, ty, self.arena);
            match self.lexer.token {
                T::CloseBrace => {}
                T::Comma | T::Semi => {
                    self.lexer.next()?;
                }
                _ => {
                    if !self.lexer.has_newline_before {
                        self.lexer.unexpected()?;
                        return Err(Error::Syntax);
                    }
                }
            }
        }
        let end = N::end(&self.lexer);
        self.lexer.expect(T::CloseBrace)?;
        Ok(N::members(members, end))
    }

    pub fn skip_type_arguments<N: PartSink>(&mut self) -> Result<N::With<bool, N::TypeArgs>, Error> {
        if self.lexer.token != T::Lt {
            return Ok(N::with(false, N::TypeArgs::default()));
        }
        let lt_end = N::end(&self.lexer);
        self.lexer.next()?;
        let mut items = N::Types::default();
        loop {
            let mut item = N::Out::default();
            self.skip_type_with_opts::<N>(Level::Lowest, 0, &mut item)?;
            N::push_type(&mut items, &mut item, self.arena);
            if self.lexer.token != T::Comma {
                break;
            }
            self.lexer.next()?;
        }
        let gt_end = N::after_first_char(&self.lexer);
        self.lexer.expect_greater_than()?;
        Ok(N::with(true, N::type_args(items, lt_end, gt_end)))
    }

    #[inline]
    fn lexer_backtracker_bool<F, R>(&mut self, func: F) -> bool
    where
        F: FnOnce(&mut Self) -> Result<R, Error>,
    {
        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        self.lexer.is_log_disabled = true;
        let mut backtrack = false;
        match func(self) {
            Ok(_) => {}
            Err(_) => {
                backtrack = true;
            }
        }
        if backtrack {
            self.lexer.restore(&old_lexer);
        }
        self.lexer.is_log_disabled = old_log_disabled;
        !backtrack
    }

    pub fn skip_arrow_args_with_backtracking<N: PartSink>(&mut self) -> Result<N::With<bool, N::Params>, Error> {
        let params = self.skip_fn_args::<N>()?;
        if self.lexer.expect(T::Arrow).is_err() {
            return Err(Error::Backtrack);
        }
        Ok(N::with(true, params))
    }

    pub fn try_skip_arrow_args_with_backtracking<N: PartSink>(&mut self) -> N::With<bool, N::Params> {
        N::attempt(self, Self::skip_arrow_args_with_backtracking::<N>)
    }

    pub fn skip_type_arguments_with_backtracking(&mut self) -> Result<bool, Error> {
        if self.skip_type_arguments::<Discard>()? {
            if self.lexer.token != T::OpenParen {
                return Err(Error::Backtrack);
            }
        }
        Ok(true)
    }

    pub fn try_skip_type_arguments_with_backtracking(&mut self) -> bool {
        self.lexer_backtracker_bool(Self::skip_type_arguments_with_backtracking)
    }
}

/// Stands for the callers in the other files of the parser.
#[inline(never)]
pub fn transpile(p: &mut P<'_, true>, with_metadata: bool, sum: &mut usize) -> Result<(), Error> {
    p.lexer.next()?;
    while p.lexer.token != T::Eof {
        if p.lexer.token == T::Colon {
            p.lexer.next()?;
            if with_metadata {
                let m = p.skip_type_with_metadata(Level::Lowest)?;
                *sum += match m {
                    Metadata::MDot(v) => v.len(),
                    Metadata::MIdentifier(r) => r.0 as usize,
                    _ => 1,
                };
            } else {
                p.skip_type(Level::Lowest)?;
            }
        } else if p.lexer.token == T::Lt {
            if p.try_skip_type_arguments_with_backtracking() {
                *sum += 1;
            } else {
                p.lexer.next()?;
            }
        } else if p.lexer.token == T::OpenBrace {
            p.skip_object_type::<Discard>()?;
        } else {
            p.lexer.next()?;
        }
    }
    Ok(())
}
