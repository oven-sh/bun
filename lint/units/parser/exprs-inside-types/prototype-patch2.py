#!/usr/bin/env python3
"""Second layer of the prototype, on top of prototype-patch.py: the restart of a reader of today at a saved offset.
usage: prototype-patch2.py <directory of a copy of src/js_parser that prototype-patch.py patched>
Adds Lexer::rewind_to, P::begin_retry_in_type / end_retry_in_type, and two users: "(" that no function type of today
follows (read again as a function type with initializers), and "[" of a member of an object type whose content is no
type (read again as an expression). The hot path pays the saved offset and nothing else."""
import sys
d = sys.argv[1]


def rep(s, old, new, count=1):
    assert s.count(old) >= count, (old[:80], s.count(old))
    return s.replace(old, new, count)


# ------------------------------------------------------------------ lexer.rs
p = d + '/lexer.rs'
s = open(p).read()
s = rep(s, '''    /// Look ahead at the next n codepoints without advancing the iterator.''', '''    /// Goes back to `offset`, where a token starts or where the token before it ends, and reads the token again.
    /// Only for the normal mode of the lexer: not inside a template, a regular expression or a JSX element.
    #[cold]
    #[inline(never)]
    pub(crate) fn rewind_to(&mut self, offset: usize) -> Result<(), Error> {
        debug_assert!(offset <= self.end);
        debug_assert!(self.temp_buffer_u16.is_empty());
        while self
            .all_comments
            .last()
            .is_some_and(|r| r.loc.start as usize >= offset)
        {
            self.all_comments.pop();
        }
        while self
            .comments_to_preserve_before
            .last()
            .is_some_and(|c| c.loc.start as usize >= offset)
        {
            self.comments_to_preserve_before.pop();
        }
        self.prev_error_loc = Loc::EMPTY;
        self.current = offset;
        self.end = offset;
        self.step();
        self.next()
    }

    /// Look ahead at the next n codepoints without advancing the iterator.''')
open(p, 'w').write(s)

# ------------------------------------------------------------------ p.rs
p = d + '/p.rs'
s = open(p).read()
s = rep(s, '''/// See [`P::begin_erased_parse`].''', '''/// What a reader of today left when it failed. See [`P::begin_retry_in_type`].
pub(crate) struct FailedRead<'a> {
    lexer: js_lexer::LexerSnapshot<'a>,
    legal_comments: Vec<js_ast::G::Comment>,
    comments: Vec<bun_ast::Range>,
    msgs: Vec<bun_ast::Msg>,
    errors: u32,
    warnings: u32,
}

/// See [`P::begin_erased_parse`].''')
s = rep(s, '''    /// Starts the parse of an expression, a decorator list or a function body that sits inside type syntax.''', '''    /// A reader of today started at `offset` and failed with the log enabled. Sets aside what it left and goes
    /// back to `offset`, so that another reader can try the same tokens.
    #[cold]
    #[inline(never)]
    pub(crate) fn begin_retry_in_type(
        &mut self,
        offset: usize,
    ) -> Result<FailedRead<'a>, crate::Error> {
        let lexer = self.lexer.snapshot();
        let legal = &mut self.lexer.comments_to_preserve_before;
        let from = legal
            .iter()
            .position(|c| c.loc.start as usize >= offset)
            .unwrap_or(legal.len());
        let legal_comments = legal.split_off(from);
        let all = &mut self.lexer.all_comments;
        let from = all
            .iter()
            .position(|r| r.loc.start as usize >= offset)
            .unwrap_or(all.len());
        let comments = all.split_off(from);

        let log = self.log();
        let (errors, warnings) = (log.errors, log.warnings);
        let mut first = log.msgs.len();
        while first > 0
            && log.msgs[first - 1]
                .data
                .location
                .as_ref()
                .is_some_and(|l| l.offset >= offset)
        {
            first -= 1;
        }
        let msgs = log.msgs.split_off(first);
        for msg in &msgs {
            match msg.kind {
                bun_ast::Kind::Err => log.errors -= 1,
                bun_ast::Kind::Warn => log.warnings -= 1,
                _ => {}
            }
        }

        self.lexer.rewind_to(offset)?;
        Ok(FailedRead {
            lexer,
            legal_comments,
            comments,
            msgs,
            errors,
            warnings,
        })
    }

    /// True when the second reader read the tokens without an error. Otherwise the lexer and the log are what the
    /// reader of today left.
    #[cold]
    #[inline(never)]
    pub(crate) fn end_retry_in_type(
        &mut self,
        offset: usize,
        kept: FailedRead<'a>,
        retry: Result<(), crate::Error>,
    ) -> Result<bool, crate::Error> {
        let errors_of_today = kept
            .msgs
            .iter()
            .filter(|m| m.kind == bun_ast::Kind::Err)
            .count() as u32;
        let clean = self.log().errors + errors_of_today == kept.errors;
        match retry {
            Ok(()) if clean => return Ok(true),
            Err(err @ (crate::Error::StackOverflow | crate::Error::Alloc(_))) => return Err(err),
            _ => {}
        }

        let log = self.log();
        while log.msgs.last().is_some_and(|m| {
            m.data
                .location
                .as_ref()
                .is_some_and(|l| l.offset >= offset)
        }) {
            log.msgs.pop();
        }
        log.msgs.extend(kept.msgs);
        log.errors = kept.errors;
        log.warnings = kept.warnings;

        let legal = &mut self.lexer.comments_to_preserve_before;
        while legal
            .last()
            .is_some_and(|c| c.loc.start as usize >= offset)
        {
            legal.pop();
        }
        legal.extend(kept.legal_comments);
        let all = &mut self.lexer.all_comments;
        while all.last().is_some_and(|r| r.loc.start as usize >= offset) {
            all.pop();
        }
        all.extend(kept.comments);
        self.lexer.restore(&kept.lexer);
        Ok(false)
    }

    /// Starts the parse of an expression, a decorator list or a function body that sits inside type syntax.''')
open(p, 'w').write(s)

# ------------------------------------------------------------------ parse_skip_typescript.rs
p = d + '/parse/parse_skip_typescript.rs'
s = open(p).read()

# "(": a type that ")" does not follow, or that failed, is read again as a function type
s = rep(s, '''        if self.try_skip_type_script_arrow_args_with_backtracking() {
            self.skip_typescript_return_type()?;
            S::function_type(out);
        } else {
            self.lexer.expect(T::TOpenParen)?;
            let mut inner = S::Out::default();
            self.mark_type_script_only();
            self.skip_type_script_type_with_opts::<S>(
                Level::Lowest,
                SkipTypeOptionsBitset::empty(),
                &mut inner,
            )?;
            S::parenthesized(out, inner);
            self.lexer.expect(T::TCloseParen)?;
        }
        Ok(())
    }
''', '''        let open_paren = self.lexer.start;
        if self.try_skip_type_script_arrow_args_with_backtracking() {
            self.skip_typescript_return_type()?;
            S::function_type(out);
        } else {
            self.lexer.expect(T::TOpenParen)?;
            let mut inner = S::Out::default();
            self.mark_type_script_only();
            let today = self.skip_type_script_type_with_opts::<S>(
                Level::Lowest,
                SkipTypeOptionsBitset::empty(),
                &mut inner,
            );
            if today.is_err() || self.lexer.token != T::TCloseParen {
                // "(a = 1) => b"
                if self.retry_in_type(open_paren, today, Retry::FunctionType)? {
                    S::function_type(out);
                    return Ok(());
                }
            }
            S::parenthesized(out, inner);
            self.lexer.expect(T::TCloseParen)?;
        }
        Ok(())
    }

    /// A reader of today started at `offset` and failed or stopped at a wrong token. True when the reader of the
    /// reference read the same tokens. Otherwise the error of today, or what today's reader left.
    #[cold]
    #[inline(never)]
    fn retry_in_type(
        &mut self,
        offset: usize,
        today: Result<(), Error>,
        what: Retry,
    ) -> Result<bool, Error> {
        if self.lexer.is_log_disabled {
            today?;
            return Ok(false);
        }
        if let Err(err @ (Error::StackOverflow | Error::Alloc(_))) = today {
            return Err(err);
        }
        let kept = self.begin_retry_in_type(offset)?;
        let retry = match what {
            Retry::FunctionType => self.skip_function_type_in_type(),
            Retry::ComputedName => self.skip_computed_name_in_type(),
        };
        if self.end_retry_in_type(offset, kept, retry)? {
            return Ok(true);
        }
        today?;
        Ok(false)
    }

    fn skip_function_type_in_type(&mut self) -> Result<(), Error> {
        self.skip_typescript_fn_args()?;
        self.lexer.expect(T::TEqualsGreaterThan)?;
        self.skip_typescript_return_type()
    }

    fn skip_computed_name_in_type(&mut self) -> Result<(), Error> {
        let _ = self.parse_expr_in_type(TypeExpr::ComputedName)?;
        self.lexer.expect(T::TCloseBracket)?;
        Ok(())
    }
''')
s = rep(s, '''const MEMBER_WITH_TYPE: u8 = 0;''', '''/// What the reader of the reference reads where a reader of today failed.
#[derive(Clone, Copy)]
enum Retry {
    FunctionType,
    ComputedName,
}

const MEMBER_WITH_TYPE: u8 = 0;''')

# "[" of a member: content that is no type is read again as an expression
s = rep(s, '''            if self.lexer.token == T::TOpenBracket {
                // Index signature or computed property
                self.lexer.next()?;
                self.skip_type_script_type_with_opts::<Discard>(
                    Level::Lowest,
                    SkipTypeOptionsBitset::only(SkipTypeOptions::IsIndexSignature),
                    &mut (),
                )?;

                // "{ [key: string]: number }"
                // "{ readonly [K in keyof T]: T[K] }"
                match self.lexer.token {
                    T::TColon => {
                        self.lexer.next()?;
                        self.skip_type_script_type(Level::Lowest)?;
                    }
                    T::TIn => {
                        self.lexer.next()?;
                        self.skip_type_script_type(Level::Lowest)?;
                        if self.lexer.is_contextual_keyword(b"as") {
                            // "{ [K in keyof T as `get-${K}`]: T[K] }"
                            self.lexer.next()?;
                            self.skip_type_script_type(Level::Lowest)?;
                        }
                    }
                    _ => {}
                }

                self.lexer.expect(T::TCloseBracket)?;
''', '''            if self.lexer.token == T::TOpenBracket {
                // Index signature or computed property
                let after_bracket = self.lexer.end;
                self.lexer.next()?;
                'content: {
                    let today = self.skip_type_script_type_with_opts::<Discard>(
                        Level::Lowest,
                        SkipTypeOptionsBitset::only(SkipTypeOptions::IsIndexSignature),
                        &mut (),
                    );

                    // "{ [key: string]: number }"
                    // "{ readonly [K in keyof T]: T[K] }"
                    match self.lexer.token {
                        T::TColon if today.is_ok() => {
                            self.lexer.next()?;
                            self.skip_type_script_type(Level::Lowest)?;
                        }
                        T::TIn if today.is_ok() => {
                            self.lexer.next()?;
                            self.skip_type_script_type(Level::Lowest)?;
                            if self.lexer.is_contextual_keyword(b"as") {
                                // "{ [K in keyof T as `get-${K}`]: T[K] }"
                                self.lexer.next()?;
                                self.skip_type_script_type(Level::Lowest)?;
                            }
                        }
                        T::TCloseBracket if today.is_ok() => {}
                        _ => {
                            // "{ [a + b]: number }"
                            if self.retry_in_type(after_bracket, today, Retry::ComputedName)? {
                                break 'content;
                            }
                        }
                    }

                    self.lexer.expect(T::TCloseBracket)?;
                }
''')
open(p, 'w').write(s)
print('patched', d)

# ------------------------------------------------------------------ p.rs: restore_parser_snapshot keeps the symbols
p = d + '/p.rs'
s = open(p).read()
s = rep(s, '''        // Enum and namespace symbols also key `ref_to_ts_namespace_member`; a symbol
        // that later reuses the index must not inherit their namespace data.
        if self.symbols.len() > snapshot.symbols_len {
            self.symbols.truncate(snapshot.symbols_len);
            if TYPESCRIPT {
                self.ts_use_counts.truncate(snapshot.symbols_len);
            }
            let stale: Vec<Ref> = self
                .ref_to_ts_namespace_member
                .keys()
                .filter(|ref_| ref_.inner_index() as usize >= snapshot.symbols_len)
                .copied()
                .collect();
            for ref_ in stale {
                self.ref_to_ts_namespace_member.remove(&ref_);
            }
        }
        self.allocated_names.truncate(snapshot.allocated_names_len);
        self.import_records.truncate(snapshot.import_records_len);''', '''        // Symbols stay: a member of a live scope may name one (an unbound name that a type of a decorated member used).
        let _ = (snapshot.symbols_len, snapshot.allocated_names_len);
        self.import_records.truncate(snapshot.import_records_len);''')
open(p, 'w').write(s)
print('patched restore_parser_snapshot', d)
