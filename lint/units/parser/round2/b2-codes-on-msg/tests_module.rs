#[cfg(test)]
mod tests {
    use super::*;
    use crate::defines::Define;
    use crate::parse::parse_entry::{Options, Parser};
    use crate::parser::{ParseStatementOptions, StatementScope};
    use bun_alloc::Arena;
    use bun_ast::{Loader, Source};
    use core::mem::MaybeUninit;

    /// An error as a test reads it: the words of Bun, the code on the message, and the range and the text of its entry.
    #[derive(Debug, PartialEq, Eq)]
    struct Reported {
        said: Vec<u8>,
        code: Option<u32>,
        entry: Option<(u32, u32, Vec<u8>)>,
    }

    fn options(loader: Loader) -> Options<'static> {
        let mut options = Options::init(Default::default(), loader);
        options.features.no_macros = true;
        options.features.dont_bundle_twice = true;
        options
    }

    fn path_of(loader: Loader) -> &'static [u8] {
        match loader {
            Loader::Js => b"/a.js",
            Loader::Tsx => b"/a.tsx",
            _ => b"/a.ts",
        }
    }

    /// The errors of `log` with their entries. Every message with a code has an entry, and no other has one.
    fn reported(log: &Log, errors: &SyntaxErrors) -> Vec<Reported> {
        let mut found = Vec::new();
        for (index, msg) in log.msgs.iter().enumerate() {
            let entry = errors.get(index);
            assert_eq!(
                msg.code().is_some(),
                entry.is_some(),
                "{}",
                bstr::BStr::new(&msg.data.text)
            );
            if msg.kind == Kind::Err {
                found.push(Reported {
                    said: msg.data.text.to_vec(),
                    code: msg.code(),
                    entry: entry.map(|entry| (entry.start, entry.end, entry.text.to_vec())),
                });
            }
        }
        found
    }

    /// The errors that the lint parse of `text` left. Empty: it parses.
    fn lint_errors(path: &'static [u8], text: &'static [u8], loader: Loader) -> Vec<Reported> {
        let arena = Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = Source::init_path_string(path, text);
        let define = Define::default();
        let mut log = Log::init();
        let mut errors = SyntaxErrors::default();
        let parser = Parser::init_for_lint_with_codes(
            options(loader),
            &mut log,
            &source,
            &define,
            &arena,
            &mut errors,
        );
        let parsed =
            parser.and_then(|parser| parser.parse_for_lint_with_codes(&mut errors, |_| ()));
        if parsed.is_ok() {
            return Vec::new();
        }
        reported(&log, &errors)
    }

    /// The first error that the lint parse of `text` left, as code, start, end and text of the reference. `None`: it parses.
    fn first_error(
        path: &'static [u8],
        text: &'static [u8],
        loader: Loader,
    ) -> Option<(u32, u32, u32, Vec<u8>)> {
        let first = lint_errors(path, text, loader).into_iter().next()?;
        let Some((start, end, message)) = first.entry else {
            return Some((0, 0, 0, Vec::new()));
        };
        Some((first.code.unwrap_or(0), start, end, message))
    }

    /// The parse pass of `Parser::parse`: no side table.
    fn parse_pass<const TS: bool>(parser: Parser<'_>) {
        let mut slot = MaybeUninit::<P<'_, TS, false>>::uninit();
        let made = P::init(
            &mut slot,
            parser.bump,
            parser.log,
            parser.source,
            parser.define,
            parser.lexer,
            parser.options,
        );
        if made.is_err() {
            return;
        }
        // SAFETY: `init` returned `Ok`, so the slot holds a parser.
        let p = unsafe { slot.assume_init_mut() };
        let mut opts = ParseStatementOptions {
            scope: StatementScope::Module,
            ..Default::default()
        };
        let _ = p.parse_stmts_up_to(T::TEndOfFile, &mut opts);
        // SAFETY: the slot holds the parser that `init` made, and nothing reads it after this.
        unsafe { slot.assume_init_drop() };
    }

    /// The code of each message that a parse of `text` without lint left, and the count of its errors.
    fn codes_without_lint(text: &'static [u8], loader: Loader) -> (Vec<Option<u32>>, u32) {
        let arena = Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = Source::init_path_string(path_of(loader), text);
        let define = Define::default();
        let mut log = Log::init();
        if let Ok(parser) = Parser::init(options(loader), &mut log, &source, &define, &arena) {
            if parser.options.ts {
                parse_pass::<true>(parser);
            } else {
                parse_pass::<false>(parser);
            }
        }
        (log.msgs.iter().map(Msg::code).collect(), log.errors)
    }

    /// The code of each message that the first token of `text` left when it failed. `None`: it did not fail.
    fn codes_of_first_token(
        text: &'static [u8],
        loader: Loader,
        is_for_lint: bool,
    ) -> Option<Vec<Option<u32>>> {
        let arena = Arena::new();
        let source = Source::init_path_string(path_of(loader), text);
        let define = Define::default();
        let mut log = Log::init();
        let parser = if is_for_lint {
            Parser::init_for_lint(options(loader), &mut log, &source, &define, &arena)
        } else {
            Parser::init(options(loader), &mut log, &source, &define, &arena)
        };
        if parser.is_ok() {
            return None;
        }
        Some(log.msgs.iter().map(Msg::code).collect())
    }

    fn range(start: i32, len: i32) -> Range {
        Range {
            loc: Loc { start },
            len,
        }
    }

    #[test]
    fn a_message_takes_its_argument() {
        assert_eq!(&*X_0_EXPECTED.format(b";"), b"';' expected.");
        assert_eq!(&*TYPE_EXPECTED.format(b""), b"Type expected.");
        assert_eq!(
            &*IDENTIFIER_EXPECTED_0_IS_A_RESERVED_WORD_THAT_CANNOT_BE_USED_HERE.format(b"class"),
            b"Identifier expected. 'class' is a reserved word that cannot be used here."
        );
    }

    #[test]
    fn the_text_of_the_lexer_says_what_it_expected() {
        let parts = split_expected(b"Expected \";\" but found \"x but found y\"");
        assert_eq!(parts, Some((&b"\";\""[..], &b"\"x but found y\""[..])));
        let parts = split_expected(b"Expected identifier but found end of file");
        assert_eq!(parts, Some((&b"identifier"[..], &b"end of file"[..])));
        assert_eq!(split_expected(b"Unexpected ;"), None);
        assert_eq!(unquote(b"\"=>\""), Some(&b"=>"[..]));
        assert_eq!(unquote(b"identifier"), None);
    }

    #[test]
    fn an_unterminated_string_ends_with_its_line() {
        assert_eq!(end_of_unterminated_string(b"x = \"abc", 4), 8);
        assert_eq!(end_of_unterminated_string(b"x = \"abc\ny", 4), 8);
        assert_eq!(end_of_unterminated_string(b"x = 'a\\\nb\nc", 4), 9);
        assert_eq!(end_of_unterminated_string(b"x = 'a\\", 4), 7);
    }

    #[test]
    fn a_code_goes_with_the_message_that_the_log_drops() {
        let source = Source::init_path_string(&b"/a.ts"[..], &b"let x: ;\nfunction () {}\n"[..]);
        let mut log = Log::init();
        let mut errors = SyntaxErrors::starting_at(0);

        // What an attempt logs and takes back.
        log.add_range_error(Some(&source), range(7, 1), b"Unexpected ;");
        errors.record(&mut log, 0, TYPE_EXPECTED, b"", range(7, 1));
        assert_eq!(log.msgs[0].code(), Some(1110));
        log.msgs.clear();
        log.errors = 0;

        // What stays: the lexer logged it and no site gave it a code.
        log.add_range_error_fmt(
            Some(&source),
            range(18, 1),
            format_args!("Expected identifier but found \"{}\"", "("),
        );
        assert_eq!(log.msgs[0].code(), None);
        errors.finish(&mut log, source.contents());

        assert_eq!(log.msgs[0].code(), Some(1003));
        let expected = SyntaxError {
            msg: 0,
            start: 18,
            end: 19,
            text: Cow::Borrowed(b"Identifier expected."),
        };
        assert_eq!(errors.entries(), &[expected.clone()][..]);
        assert_eq!(errors.get(0), Some(&expected));
        assert_eq!(errors.get(1), None);
    }

    #[test]
    fn a_code_stays_with_the_message_that_the_log_keeps() {
        let source = Source::init_path_string(&b"/a.ts"[..], &b"default\n"[..]);
        let mut log = Log::init();
        let mut errors = SyntaxErrors::starting_at(0);

        log.add_range_error(Some(&source), range(0, 7), b"Unexpected default");
        errors.record(&mut log, 0, EXPRESSION_EXPECTED, b"", range(0, 7));
        errors.refine(&mut log, 0, EXPRESSION_EXPECTED, X_0_EXPECTED, b"export");
        assert_eq!(log.msgs[0].code(), Some(1005));
        // The message no longer carries what a second call would replace.
        errors.refine(&mut log, 0, EXPRESSION_EXPECTED, X_0_EXPECTED, b"try");
        // A record for a message that was not logged is none.
        errors.record(&mut log, 1, TYPE_EXPECTED, b"", range(0, 7));
        // The parser sets the message aside and puts it back.
        let aside = log.msgs.split_off(0);
        log.msgs.extend(aside);
        errors.finish(&mut log, source.contents());

        assert_eq!(log.msgs[0].code(), Some(1005));
        let expected = SyntaxError {
            msg: 0,
            start: 0,
            end: 7,
            text: Cow::Borrowed(b"'export' expected."),
        };
        assert_eq!(errors.entries(), &[expected][..]);
    }

    #[test]
    fn a_message_that_comes_back_finds_its_own_record() {
        let text = &b"type T = { [: string]: b };\n"[..];
        let source = Source::init_path_string(&b"/a.ts"[..], text);
        let mut log = Log::init();
        let mut errors = SyntaxErrors::starting_at(0);

        // The first reading, set aside.
        log.add_range_error(Some(&source), range(12, 1), b"Unexpected :");
        errors.record(&mut log, 0, TYPE_EXPECTED, b"", range(12, 1));
        let aside = log.msgs.split_off(0);
        // The other reading logs the same words at the same place under another code, and goes.
        log.add_range_error(Some(&source), range(12, 1), b"Unexpected :");
        errors.record(&mut log, 0, EXPRESSION_EXPECTED, b"", range(12, 1));
        assert_eq!(log.msgs[0].code(), Some(1109));
        log.msgs.clear();
        log.msgs.extend(aside);
        errors.finish(&mut log, source.contents());

        assert_eq!(log.msgs[0].code(), Some(1110));
        let expected = SyntaxError {
            msg: 0,
            start: 12,
            end: 13,
            text: Cow::Borrowed(b"Type expected."),
        };
        assert_eq!(errors.entries(), &[expected][..]);
    }

    #[test]
    fn a_message_in_the_words_of_the_reference_is_its_own_entry() {
        let source = Source::init_path_string(&b"/a.ts"[..], &b"default = 1;\n"[..]);
        let mut log = Log::init();
        let mut errors = SyntaxErrors::starting_at(0);

        // A record that a dropped message left for the same code at the same place.
        log.add_range_error(Some(&source), range(0, 7), b"Unexpected default");
        errors.record(&mut log, 0, EXPRESSION_EXPECTED, b"", range(0, 7));
        errors.refine(&mut log, 0, EXPRESSION_EXPECTED, X_0_EXPECTED, b"export");
        log.msgs.clear();
        log.errors = 0;
        // What `P::lint_error` logs.
        log.add_range_error_with_code(
            Some(&source),
            range(0, 7),
            X_0_EXPECTED.code,
            X_0_EXPECTED.format(b";"),
            Box::default(),
        );
        errors.finish(&mut log, source.contents());

        assert_eq!(log.msgs[0].code(), Some(1005));
        let expected = SyntaxError {
            msg: 0,
            start: 0,
            end: 7,
            text: Cow::Borrowed(b"';' expected."),
        };
        assert_eq!(errors.entries(), &[expected][..]);
    }

    #[test]
    fn only_the_errors_of_the_parse_get_a_code() {
        let source = Source::init_path_string(&b"/a.ts"[..], &b"-->\n\"abc"[..]);
        let mut log = Log::init();
        log.level = bun_ast::Level::Warn;
        // A message from before the parse, a warning of the parse, and its error.
        log.add_range_error_fmt(
            Some(&source),
            range(0, 1),
            format_args!("Expected \";\" but found \"{}\"", "-"),
        );
        log.add_range_warning(Some(&source), range(0, 3), b"Treating \"-->\" as a comment");
        log.add_range_error_fmt(
            Some(&source),
            range(4, 0),
            format_args!("Unterminated string literal"),
        );
        let errors = SyntaxErrors::of_first_token(&mut log, 1, source.contents());

        let codes: Vec<Option<u32>> = log.msgs.iter().map(Msg::code).collect();
        assert_eq!(codes, [None, None, Some(1002)]);
        let expected = SyntaxError {
            msg: 2,
            start: 8,
            end: 8,
            text: Cow::Borrowed(b"Unterminated string literal."),
        };
        assert_eq!(errors.entries(), &[expected][..]);
    }

    #[test]
    fn a_syntax_error_of_a_lint_parse_has_the_code_of_the_reference() {
        let cases: [(&'static [u8], Loader, u32, u32, u32, &str); 19] = [
            (b"x = a ? b", Loader::Ts, 1005, 9, 9, "':' expected."),
            (b"f(1;", Loader::Ts, 1005, 3, 4, "')' expected."),
            (
                b"function (",
                Loader::Ts,
                1003,
                9,
                10,
                "Identifier expected.",
            ),
            (
                b"function class() {}",
                Loader::Ts,
                1359,
                9,
                14,
                "Identifier expected. 'class' is a reserved word that cannot be used here.",
            ),
            (
                b"x = \"abc",
                Loader::Ts,
                1002,
                8,
                8,
                "Unterminated string literal.",
            ),
            (
                b"x = `abc",
                Loader::Ts,
                1160,
                8,
                8,
                "Unterminated template literal.",
            ),
            (b"let x = ;", Loader::Ts, 1109, 8, 9, "Expression expected."),
            (b"let x = ;", Loader::Js, 1109, 8, 9, "Expression expected."),
            (b"x = 1 +", Loader::Ts, 1109, 7, 7, "Expression expected."),
            (b"if (x) )", Loader::Ts, 1109, 7, 8, "Expression expected."),
            (b"in x", Loader::Ts, 1109, 0, 2, "Expression expected."),
            (
                b")",
                Loader::Ts,
                1128,
                0,
                1,
                "Declaration or statement expected.",
            ),
            (
                b"{ ) }",
                Loader::Js,
                1128,
                2,
                3,
                "Declaration or statement expected.",
            ),
            (
                b"function f() { default }",
                Loader::Ts,
                1128,
                15,
                22,
                "Declaration or statement expected.",
            ),
            (b"default", Loader::Ts, 1005, 0, 7, "'export' expected."),
            (b"catch (e) {}", Loader::Ts, 1005, 0, 5, "'try' expected."),
            (b"let x: ;", Loader::Ts, 1110, 7, 8, "Type expected."),
            (
                b"function f(a: ) {}",
                Loader::Ts,
                1110,
                14,
                15,
                "Type expected.",
            ),
            (b"let x: A<;", Loader::Ts, 1005, 9, 10, "'>' expected."),
        ];
        for (text, loader, code, start, end, message) in cases {
            assert_eq!(
                first_error(path_of(loader), text, loader),
                Some((code, start, end, message.as_bytes().to_vec())),
                "{}",
                bstr::BStr::new(text)
            );
            // The same source without lint is an error too, and none of its messages has a code.
            let (codes, count) = codes_without_lint(text, loader);
            assert!(count > 0, "{}", bstr::BStr::new(text));
            assert!(
                !codes.is_empty() && codes.iter().all(Option::is_none),
                "{}",
                bstr::BStr::new(text)
            );
        }
    }

    #[test]
    fn an_error_in_the_first_token_has_the_code_of_the_reference() {
        let cases: [(&'static [u8], Loader, u32, u32, u32, &str); 8] = [
            (
                b"\"abc",
                Loader::Ts,
                1002,
                4,
                4,
                "Unterminated string literal.",
            ),
            (
                b"\"abc",
                Loader::Js,
                1002,
                4,
                4,
                "Unterminated string literal.",
            ),
            (
                b"\"abc",
                Loader::Tsx,
                1002,
                4,
                4,
                "Unterminated string literal.",
            ),
            (
                b"'abc\n x",
                Loader::Ts,
                1002,
                4,
                4,
                "Unterminated string literal.",
            ),
            (
                b"  \"abc\r\nx",
                Loader::Ts,
                1002,
                6,
                6,
                "Unterminated string literal.",
            ),
            (
                b"`abc ",
                Loader::Ts,
                1160,
                5,
                5,
                "Unterminated template literal.",
            ),
            (b"/* abc", Loader::Ts, 1010, 6, 6, "'*/' expected."),
            (b"// c\n/* abc", Loader::Ts, 1010, 11, 11, "'*/' expected."),
        ];
        for (text, loader, code, start, end, message) in cases {
            assert_eq!(
                first_error(path_of(loader), text, loader),
                Some((code, start, end, message.as_bytes().to_vec())),
                "{}",
                bstr::BStr::new(text)
            );
            // The token fails in `Parser::init` too, which gives no code.
            assert_eq!(
                codes_of_first_token(text, loader, false),
                Some(vec![None]),
                "{}",
                bstr::BStr::new(text)
            );
            assert_eq!(
                codes_of_first_token(text, loader, true),
                Some(vec![Some(code)]),
                "{}",
                bstr::BStr::new(text)
            );
            let (codes, count) = codes_without_lint(text, loader);
            assert_eq!((codes, count), (vec![None], 1), "{}", bstr::BStr::new(text));
        }
    }

    #[test]
    fn init_for_lint_keeps_the_comments_before_the_first_token() {
        let text = &b"/* a */ // b\nx;\n"[..];
        let arena = Arena::new();
        let source = Source::init_path_string(&b"/a.ts"[..], text);
        let define = Define::default();
        let mut log = Log::init();
        let kept = |is_for_lint: bool, log: &mut Log| {
            let parser = if is_for_lint {
                Parser::init_for_lint(options(Loader::Ts), log, &source, &define, &arena)
            } else {
                Parser::init(options(Loader::Ts), log, &source, &define, &arena)
            };
            parser.ok().map(|parser| parser.lexer.all_comments.clone())
        };
        assert_eq!(kept(false, &mut log), Some(Vec::new()));
        assert_eq!(kept(true, &mut log), Some(vec![range(0, 7), range(8, 4)]));
    }

    #[test]
    fn a_message_that_is_set_aside_and_put_back_keeps_its_code() {
        // The type in parentheses fails, the function type that is read there instead fails too, and the first message comes back.
        let found = lint_errors(b"/a.ts", b"let x: ( ;", Loader::Ts);
        let expected = Reported {
            said: b"Unexpected ;".to_vec(),
            code: Some(1110),
            entry: Some((9, 10, b"Type expected.".to_vec())),
        };
        assert_eq!(found, [expected]);
    }

    #[test]
    fn lint_error_logs_in_a_lint_parse_only() {
        let arena = Arena::new();
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::borrowing(&arena);
        let _ast_scope = ast_memory_allocator.enter();
        let source = Source::init_path_string(&b"/a.ts"[..], &b"a b\n"[..]);
        let define = Define::default();
        let mut log = Log::init();
        let parser = Parser::init(options(Loader::Ts), &mut log, &source, &define, &arena);
        assert!(parser.is_ok());
        let Ok(parser) = parser else {
            return;
        };
        let mut slot = MaybeUninit::<P<'_, true, false>>::uninit();
        let made = P::init(
            &mut slot,
            parser.bump,
            parser.log,
            parser.source,
            parser.define,
            parser.lexer,
            parser.options,
        );
        assert!(made.is_ok());
        if made.is_err() {
            return;
        }
        // SAFETY: `init` returned `Ok`, so the slot holds a parser.
        let p = unsafe { slot.assume_init_mut() };

        // `Parser::parse` has no side table, and the one of `Parser::parse_only` is none of a lint parse.
        assert!(!p.lint_error(range(2, 1), X_0_EXPECTED, b";"));
        p.starts_for_parse_only = Some(Box::default());
        assert!(!p.lint_error(range(2, 1), X_0_EXPECTED, b";"));
        assert_eq!((p.log().msgs.len(), p.log().errors), (0, 0));

        p.starts_for_parse_only = Some(crate::p::StartsForParseOnly::for_lint());
        assert!(p.lint_error(range(2, 1), X_0_EXPECTED, b";"));
        // One error for one place, as the lexer has it.
        assert!(p.lint_error(range(2, 1), TYPE_EXPECTED, b""));
        assert!(p.lint_error(range(0, 1), TYPE_EXPECTED, b""));
        let found: Vec<(Option<u32>, Vec<u8>, usize, usize)> = p
            .log()
            .msgs
            .iter()
            .map(|msg| {
                let (offset, length) = msg
                    .data
                    .location
                    .as_ref()
                    .map_or((usize::MAX, 0), |location| {
                        (location.offset, location.length)
                    });
                (msg.code(), msg.data.text.to_vec(), offset, length)
            })
            .collect();
        assert_eq!(
            found,
            [
                (Some(1005), b"';' expected.".to_vec(), 2, 1),
                (Some(1110), b"Type expected.".to_vec(), 0, 1),
            ]
        );
        assert_eq!(p.log().errors, 2);
        // SAFETY: the slot holds the parser that `init` made, and nothing reads it after this.
        unsafe { slot.assume_init_drop() };
    }

    #[test]
    fn a_lint_parse_rejects_what_an_attempt_lets_pass() {
        let cases: [(&'static [u8], u32, u32, u32, &str); 5] = [
            (b"let x: (a: ) => void", 1110, 11, 12, "Type expected."),
            (b"f<A | >(x)", 1110, 6, 7, "Type expected."),
            (b"f<,>;", 1110, 2, 3, "Type expected."),
            (b"new A<B | >()", 1110, 10, 11, "Type expected."),
            (b"let f = (a): => a", 1005, 11, 12, "';' expected."),
        ];
        for (text, code, start, end, message) in cases {
            assert_eq!(
                first_error(b"/a.ts", text, Loader::Ts),
                Some((code, start, end, message.as_bytes().to_vec())),
                "{}",
                bstr::BStr::new(text)
            );
        }
    }

    #[test]
    fn a_type_that_is_built_is_read_as_the_reference_reads_it() {
        let cases: [(&'static [u8], u32, u32, u32, &str); 7] = [
            (
                b"x as A | () => void;",
                1385,
                8,
                19,
                "Function type notation must be parenthesized when used in a union type.",
            ),
            (
                b"x as | () => void;",
                1385,
                6,
                17,
                "Function type notation must be parenthesized when used in a union type.",
            ),
            (
                b"x as A & new () => B;",
                1388,
                8,
                20,
                "Constructor type notation must be parenthesized when used in an intersection type.",
            ),
            (b"x as A & | B;", 1110, 9, 10, "Type expected."),
            (b"x as { a: };", 1110, 10, 11, "Type expected."),
            (
                b"x as { a A };",
                1131,
                7,
                8,
                "Property or signature expected.",
            ),
            (
                b"x as { a: string b: number };",
                1005,
                17,
                18,
                "';' expected.",
            ),
        ];
        for (text, code, start, end, message) in cases {
            assert_eq!(
                first_error(b"/a.ts", text, Loader::Ts),
                Some((code, start, end, message.as_bytes().to_vec())),
                "{}",
                bstr::BStr::new(text)
            );
        }
        // What `P::lint_error` logs says what the reference says, in the log too.
        let found = lint_errors(b"/a.ts", b"x as A | () => void;", Loader::Ts);
        let said = found.first().map(|error| error.said.as_slice());
        assert_eq!(
            said,
            Some(&b"Function type notation must be parenthesized when used in a union type."[..])
        );
        let parsed: [&'static [u8]; 4] = [
            b"x as A<>;",
            b"x as A<B,>;",
            b"x as A | (() => void);",
            b"x as { readonly a: string; b?(): void; [k: string]: unknown; new (): A; get c(): number };",
        ];
        for text in parsed {
            assert_eq!(
                first_error(b"/a.ts", text, Loader::Ts),
                None,
                "{}",
                bstr::BStr::new(text)
            );
        }
    }

    #[test]
    fn a_lint_parse_takes_what_the_reference_parses() {
        let cases: [&'static [u8]; 6] = [
            b"f<>()",
            b"new A<>()",
            b"f<A,>(x)",
            b"let y = a < b > (c)",
            b"let f = (a): (b) => c => a",
            b"class C { #y = 1; m(x: C) { let a: typeof x.#y; } }",
        ];
        for text in cases {
            assert_eq!(
                first_error(b"/a.ts", text, Loader::Ts),
                None,
                "{}",
                bstr::BStr::new(text)
            );
        }
    }
}
