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

    pub fn skip_fn_args(&mut self) -> Result<(), Error> {
        self.lexer.expect(T::OpenParen)?;
        while self.lexer.token != T::CloseParen {
            if self.lexer.token == T::DotDotDot {
                self.lexer.next()?;
            }
            self.skip_binding()?;
            if self.lexer.token == T::Question {
                self.lexer.next()?;
            }
            if self.lexer.token == T::Colon {
                self.lexer.next()?;
                self.skip_type(Level::Lowest)?;
            }
            if self.lexer.token != T::Comma {
                break;
            }
            self.lexer.next()?;
        }
        self.lexer.expect(T::CloseParen)?;
        Ok(())
    }

    pub fn skip_paren_or_fn_type<S: TypeSink>(&mut self, out: &mut S::Out) -> Result<(), Error> {
        if self.try_skip_arrow_args_with_backtracking() {
            self.skip_return_type()?;
            S::function_type(out);
        } else {
            self.lexer.expect(T::OpenParen)?;
            let mut inner = S::Out::default();
            self.skip_type_with_opts::<S>(Level::Lowest, 0, &mut inner)?;
            S::parenthesized(out, inner);
            self.lexer.expect(T::CloseParen)?;
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
                    self.lexer.next()?;
                    S::literal(out, TypeLiteral::Number);
                }
                T::Str => {
                    self.lexer.next()?;
                    S::literal(out, TypeLiteral::String);
                }
                T::Void => {
                    self.lexer.next()?;
                    S::keyword(out, TypeKeyword::Void);
                }
                T::Amp | T::Bar => {
                    self.lexer.next()?;
                    continue;
                }
                T::OpenParen => {
                    self.skip_paren_or_fn_type::<S>(out)?;
                }
                T::Ident => {
                    let mut check_type_parameters = true;
                    if self.lexer.identifier == b"any" {
                        self.lexer.next()?;
                        check_type_parameters = false;
                        S::keyword(out, TypeKeyword::Any);
                    } else {
                        S::reference(out, self.lexer.identifier, |name| self.find_symbol(name))?;
                        self.lexer.next()?;
                    }
                    if check_type_parameters && !self.lexer.has_newline_before {
                        let _ = self.skip_type_arguments()?;
                    }
                }
                T::Typeof => {
                    self.lexer.next()?;
                    S::typeof_query(out);
                    if !self.lexer.is_identifier_or_keyword() {
                        self.lexer.expected(T::Ident)?;
                    }
                    self.lexer.next()?;
                    while self.lexer.token == T::Dot {
                        self.lexer.next()?;
                        if !self.lexer.is_identifier_or_keyword() {
                            self.lexer.expected(T::Ident)?;
                        }
                        self.lexer.next()?;
                    }
                    if !self.lexer.has_newline_before {
                        let _ = self.skip_type_arguments()?;
                    }
                }
                T::OpenBracket => {
                    self.lexer.next()?;
                    S::tuple_type(out);
                    while self.lexer.token != T::CloseBracket {
                        if self.lexer.token == T::DotDotDot {
                            self.lexer.next()?;
                        }
                        self.skip_type_with_opts::<Discard>(Level::Lowest, 1, &mut ())?;
                        if self.lexer.token == T::Question {
                            self.lexer.next()?;
                        }
                        if self.lexer.token == T::Colon {
                            self.lexer.next()?;
                            self.skip_type(Level::Lowest)?;
                        }
                        if self.lexer.token != T::Comma {
                            break;
                        }
                        self.lexer.next()?;
                    }
                    self.lexer.expect(T::CloseBracket)?;
                }
                T::OpenBrace => {
                    self.skip_object_type()?;
                    S::object_type(out);
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
                            S::union_right(out, left);
                        }
                    }
                }
                T::Excl => {
                    if self.lexer.has_newline_before {
                        self.depth -= 1;
                        return Ok(());
                    }
                    self.lexer.next()?;
                }
                T::Dot => {
                    self.lexer.next()?;
                    if !self.lexer.is_identifier_or_keyword() {
                        self.lexer.expect(T::Ident)?;
                    }
                    let is_name = self.lexer.is_identifier_or_keyword();
                    S::member(out, self.lexer.identifier, is_name, |name| self.find_symbol(name))?;
                    self.lexer.next()?;
                    if !self.lexer.has_newline_before {
                        let _ = self.skip_type_arguments()?;
                    }
                }
                T::OpenBracket => {
                    if self.lexer.has_newline_before {
                        self.depth -= 1;
                        return Ok(());
                    }
                    self.lexer.next()?;
                    let mut skipped = false;
                    if self.lexer.token != T::CloseBracket {
                        skipped = true;
                        self.skip_type(Level::Lowest)?;
                    }
                    self.lexer.expect(T::CloseBracket)?;
                    S::index_or_array(out, skipped);
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

    pub fn skip_object_type(&mut self) -> Result<(), Error> {
        self.lexer.expect(T::OpenBrace)?;
        while self.lexer.token != T::CloseBrace {
            let mut found_key = false;
            while self.lexer.is_identifier_or_keyword() || self.lexer.token == T::Str || self.lexer.token == T::Number {
                self.lexer.next()?;
                found_key = true;
            }
            if found_key && self.lexer.token == T::Question {
                self.lexer.next()?;
            }
            match self.lexer.token {
                T::Colon => {
                    if !found_key {
                        self.lexer.expect(T::Ident)?;
                    }
                    self.lexer.next()?;
                    self.skip_type(Level::Lowest)?;
                }
                T::OpenParen => {
                    self.skip_fn_args()?;
                    if self.lexer.token == T::Colon {
                        self.lexer.next()?;
                        self.skip_return_type()?;
                    }
                }
                _ => {
                    if !found_key {
                        self.lexer.unexpected()?;
                        return Err(Error::Syntax);
                    }
                }
            }
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
        self.lexer.expect(T::CloseBrace)?;
        Ok(())
    }

    pub fn skip_type_arguments(&mut self) -> Result<bool, Error> {
        if self.lexer.token != T::Lt {
            return Ok(false);
        }
        self.lexer.next()?;
        loop {
            self.skip_type(Level::Lowest)?;
            if self.lexer.token != T::Comma {
                break;
            }
            self.lexer.next()?;
        }
        self.lexer.expect_greater_than()?;
        Ok(true)
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

    pub fn skip_arrow_args_with_backtracking(&mut self) -> Result<bool, Error> {
        self.skip_fn_args()?;
        if self.lexer.expect(T::Arrow).is_err() {
            return Err(Error::Backtrack);
        }
        Ok(true)
    }

    pub fn try_skip_arrow_args_with_backtracking(&mut self) -> bool {
        self.lexer_backtracker_bool(Self::skip_arrow_args_with_backtracking)
    }

    pub fn skip_type_arguments_with_backtracking(&mut self) -> Result<bool, Error> {
        if self.skip_type_arguments()? {
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
            p.skip_object_type()?;
        } else {
            p.lexer.next()?;
        }
    }
    Ok(())
}
