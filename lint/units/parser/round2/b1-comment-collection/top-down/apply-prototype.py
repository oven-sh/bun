#!/usr/bin/env python3
# usage: python3 apply-prototype.py <path to a copy of src/js_parser at be1ebe5295>
# The edits that this directory ends with (second version): one byte `every_comment` behind the other fields of the lexer, the
# two JSX arms that hand over to a cold copy of the function, the comments before the first token, the five places that move
# the lexer ahead, the table on the side table. Parser::init, P::init, scan_comment_text, snapshot and restore stay as they are.
# `#[inline(always)]` on parse_jsx_string_literal keeps it inside next_inside_jsx_element as before its second copy existed
# (without it the counts are those of cg-string-reader-out-of-line/).
# Every replacement must match exactly once: the script stops where the tree differs.
import sys, os

root = sys.argv[1]

def edit(rel, pairs):
    path = os.path.join(root, rel)
    s = open(path).read()
    for old, new in pairs:
        assert s.count(old) == 1, (rel, old[:90], s.count(old))
        s = s.replace(old, new)
    open(path, 'w').write(s)
    print('ok', rel, len(pairs))

edit('lexer.rs', [
 ("""    pub(crate) jsc_builtin_syntax: bool,
    pub(crate) all_comments: Vec<Range>,
}
""", """    pub(crate) jsc_builtin_syntax: bool,
    pub(crate) all_comments: Vec<Range>,
    /// Not 0 in a lint parse: comments inside JSX tags go to `all_comments` too, and a forward move keeps those it passes. A `u8` has no niche, so it is laid out behind every other field and none of them moves.
    pub(crate) every_comment: u8,
}

#[cfg(target_pointer_width = "64")]
const _: () = assert!(core::mem::size_of::<Lexer<'static>>() == 336);
#[cfg(target_pointer_width = "64")]
const _: () = assert!(core::mem::size_of::<LexerSnapshot<'static>>() == 240);
"""),
 ("""            jsc_builtin_syntax: false,
            all_comments: Vec::new(),
        }
""", """            jsc_builtin_syntax: false,
            all_comments: Vec::new(),
            every_comment: 0,
        }
"""),
 ("""    pub(crate) fn parse_jsx_string_literal<const QUOTE: u8>(&mut self) -> Result<(), Error> {
""", """    #[inline(always)]
    pub(crate) fn parse_jsx_string_literal<const QUOTE: u8>(&mut self) -> Result<(), Error> {
"""),
 ("""    pub(crate) fn next_inside_jsx_element(&mut self) -> Result<(), Error> {
        self.has_newline_before = false;

        loop {
""", """    pub(crate) fn next_inside_jsx_element(&mut self) -> Result<(), Error> {
        self.has_newline_before = false;
        self.next_inside_jsx_element_from::<false>()
    }

    /// `next_inside_jsx_element` of a lint parse, from behind the comment that it read: that comment and every one after it is recorded.
    #[cold]
    #[inline(never)]
    fn next_inside_jsx_element_with_comments(&mut self) -> Result<(), Error> {
        self.all_comments.push(self.range());
        self.next_inside_jsx_element_from::<true>()
    }

    /// The reading of `next_inside_jsx_element`. `EVERY_COMMENT`: each comment is recorded; else the first one of a lint parse hands over to the copy that does.
    #[inline(always)]
    fn next_inside_jsx_element_from<const EVERY_COMMENT: bool>(&mut self) -> Result<(), Error> {
        loop {
"""),
 ("""                                    _ => {}
                                }
                            }
                            continue;
                        }
                        0x2A => {
                            self.step();
                            'multi_line_comment: loop {""", """                                    _ => {}
                                }
                            }
                            if EVERY_COMMENT {
                                self.all_comments.push(self.range());
                            } else if self.every_comment != 0 {
                                return self.next_inside_jsx_element_with_comments();
                            }
                            continue;
                        }
                        0x2A => {
                            self.step();
                            'multi_line_comment: loop {"""),
 ("""                                    _ => {
                                        self.step();
                                    }
                                }
                            }
                            continue;
                        }
                        _ => {
                            self.token = T::TSlash;
                        }""", """                                    _ => {
                                        self.step();
                                    }
                                }
                            }
                            if EVERY_COMMENT {
                                self.all_comments.push(self.range());
                            } else if self.every_comment != 0 {
                                return self.next_inside_jsx_element_with_comments();
                            }
                            continue;
                        }
                        _ => {
                            self.token = T::TSlash;
                        }"""),
 ("""        self.all_comments.truncate(original.all_comments_len);
        self.comments_to_preserve_before
            .truncate(original.comments_to_preserve_before_len);
    }
""", """        self.all_comments.truncate(original.all_comments_len);
        self.comments_to_preserve_before
            .truncate(original.comments_to_preserve_before_len);
    }

    /// Every comment goes to `all_comments` from here on. `primed`: the first token was read with `track_comments` on; else the comments before it are read again.
    #[cold]
    #[inline(never)]
    pub(crate) fn track_every_comment(&mut self, primed: bool) {
        self.track_comments = true;
        self.every_comment = 1;
        if primed || self.start == 0 {
            return;
        }
        let mut log = Log::default();
        let mut again = Lexer::init_without_reading(&mut log, self.source, self.arena);
        again.track_comments = true;
        again.jsc_builtin_syntax = self.jsc_builtin_syntax;
        again.step();
        let _ = again.next();
        self.all_comments = core::mem::take(&mut again.all_comments);
    }

    /// The comments read since the list held `len`, for a caller that takes the lexer back and then moves it past them with `restore_past`. None unless every comment is tracked.
    #[cold]
    #[inline(never)]
    pub(crate) fn comments_since(&self, len: usize) -> Vec<Range> {
        if self.every_comment == 0 {
            return Vec::new();
        }
        self.all_comments
            .get(len..)
            .map(<[Range]>::to_vec)
            .unwrap_or_default()
    }

    /// Moves the lexer to `end`, a snapshot taken ahead of where it is: `passed` are the comments up to there, which stay.
    #[cold]
    #[inline(never)]
    pub(crate) fn restore_past(&mut self, end: &mut LexerSnapshot<'a>, passed: Vec<Range>) {
        self.all_comments.extend(passed);
        end.all_comments_len = self.all_comments.len();
        end.comments_to_preserve_before_len = self.comments_to_preserve_before.len();
        self.restore(end);
    }
"""),
])

edit('p.rs', [
 ("    /// `Parser::parse_for_lint` made it: `Parser::parse_only` keeps no parentheses.\n    pub(crate) is_lint: bool,\n",
  "    /// Every comment of a lint-parsed file, in source order.\n    pub comments: crate::parse::comments::Comments,\n    /// `Parser::parse_for_lint` made it: `Parser::parse_only` keeps no parentheses.\n    pub(crate) is_lint: bool,\n"),
])

edit('parse/parse_entry.rs', [
 ("""        let is_declaration_file = TS && is_declaration_file_name(source.path.text);
        let mut __p = init_p!(P<'_, TS, false>;
            bump, log, source, define, lexer, options);
        // SAFETY: `init_p!` only yields after `init` succeeded.
        let p: &mut P<'_, TS, false> = unsafe { __p.assume_init_mut() };
        p.starts_for_parse_only = Some(crate::p::StartsForParseOnly::for_lint());
        p.start_syntax_errors(orig_error_count);
        let parsed: Result<_, Error> = 'parse: {
            if p.lexer.token == js_lexer::T::THashbang
                && let Err(err) = p.lexer.next()
            {
                break 'parse Err(err.into());
            }
""", """        let is_declaration_file = TS && is_declaration_file_name(source.path.text);
        let primed = lexer.track_comments;
        let mut __p = init_p!(P<'_, TS, false>;
            bump, log, source, define, lexer, options);
        // SAFETY: `init_p!` only yields after `init` succeeded.
        let p: &mut P<'_, TS, false> = unsafe { __p.assume_init_mut() };
        p.starts_for_parse_only = Some(crate::p::StartsForParseOnly::for_lint());
        p.start_syntax_errors(orig_error_count);
        p.lexer.track_every_comment(primed);
        let mut first_token = 0usize;
        let parsed: Result<_, Error> = 'parse: {
            if p.lexer.token == js_lexer::T::THashbang
                && let Err(err) = p.lexer.next()
            {
                break 'parse Err(err.into());
            }
            first_token = p.lexer.start;
"""),
 ("""        let mut sidecar = p.starts_for_parse_only.take().unwrap_or_default();
        sidecar.attached.sort();
""", """        let mut sidecar = p.starts_for_parse_only.take().unwrap_or_default();
        sidecar.attached.sort();
        sidecar.comments = crate::parse::comments::Comments::of(
            &source.contents,
            &p.lexer.all_comments,
            first_token,
        );
"""),
])

edit('parse/mod.rs', [
 ("pub mod attached;\npub mod erased;\n", "pub mod attached;\npub mod comments;\npub mod erased;\n"),
 ("""        let parse_pass_symbol_uses = p.parse_pass_symbol_uses.take();
        let snapshot = p.parser_snapshot();
""", """        let parse_pass_symbol_uses = p.parse_pass_symbol_uses.take();
        let comments_len = p.lexer.all_comments.len();
        let snapshot = p.parser_snapshot();
"""),
 ("""        let has_failed = result.is_err() || p.log().errors != errors;
        let mut end = p.lexer.snapshot();
""", """        let has_failed = result.is_err() || p.log().errors != errors;
        let mut end = p.lexer.snapshot();
        let passed = p.lexer.comments_since(comments_len);
"""),
 ("""        // Only the position moves: the comments inside what was read are dropped with it.
        end.is_log_disabled = p.lexer.is_log_disabled;
        end.prev_error_loc = p.lexer.prev_error_loc;
        end.all_comments_len = p.lexer.all_comments.len();
        end.comments_to_preserve_before_len = p.lexer.comments_to_preserve_before.len();
        p.lexer.restore(&end);
        Ok(())
""", """        // Only the position moves, and a lint parse keeps the comments that were passed.
        end.is_log_disabled = p.lexer.is_log_disabled;
        end.prev_error_loc = p.lexer.prev_error_loc;
        p.lexer.restore_past(&mut end, passed);
        Ok(())
"""),
])

edit('parse/parse_skip_typescript.rs', [
 ("""struct FailedRead<'a> {
    lexer: LexerSnapshot<'a>,
    msgs: Vec<bun_ast::Msg>,
""", """struct FailedRead<'a> {
    lexer: LexerSnapshot<'a>,
    /// The comments that the reading passed, where every comment is tracked.
    comments: Vec<bun_ast::Range>,
    msgs: Vec<bun_ast::Msg>,
"""),
 ("""        let lexer = self.lexer.snapshot();
        let log = self.log();
        let first = mark.msgs_len.min(log.msgs.len());
        let failed = FailedRead {
            lexer,
            msgs: log.msgs.split_off(first),
""", """        let lexer = self.lexer.snapshot();
        let comments = self.lexer.comments_since(mark.lexer.all_comments_len);
        let log = self.log();
        let first = mark.msgs_len.min(log.msgs.len());
        let failed = FailedRead {
            lexer,
            comments,
            msgs: log.msgs.split_off(first),
"""),
 ("""        let FailedRead {
            mut lexer,
            msgs,
            errors,
            warnings,
        } = failed;
""", """        let FailedRead {
            mut lexer,
            comments,
            msgs,
            errors,
            warnings,
        } = failed;
"""),
 ("""        // The comments that the first reading passed are not collected again.
        lexer.all_comments_len = self.lexer.all_comments.len();
        lexer.comments_to_preserve_before_len = self.lexer.comments_to_preserve_before.len();
        self.lexer.restore(&lexer);
    }
""", """        self.lexer.restore_past(&mut lexer, comments);
    }
"""),
 ("""        let parse_pass_symbol_uses = self.parse_pass_symbol_uses.take();
        let snapshot = self.parser_snapshot();

        // With the log off a missing operand goes unnoticed: the count of errors decides.
        self.lexer.is_log_disabled = false;
""", """        let parse_pass_symbol_uses = self.parse_pass_symbol_uses.take();
        let comments_len = self.lexer.all_comments.len();
        let snapshot = self.parser_snapshot();

        // With the log off a missing operand goes unnoticed: the count of errors decides.
        self.lexer.is_log_disabled = false;
"""),
 ("""        let has_failed = result.is_err() || self.log().errors != errors;
        let mut end = self.lexer.snapshot();

        // Scopes, symbols, import records and messages of what was read go away, and the lexer goes back.
""", """        let has_failed = result.is_err() || self.log().errors != errors;
        let mut end = self.lexer.snapshot();
        let passed = self.lexer.comments_since(comments_len);

        // Scopes, symbols, import records and messages of what was read go away, and the lexer goes back.
"""),
 ("""        // Only the position moves: the comments inside what was read are dropped with it.
        end.is_log_disabled = self.lexer.is_log_disabled;
        end.prev_error_loc = self.lexer.prev_error_loc;
        end.all_comments_len = self.lexer.all_comments.len();
        end.comments_to_preserve_before_len = self.lexer.comments_to_preserve_before.len();
        self.lexer.restore(&end);
        Ok(())
""", """        // Only the position moves, and a lint parse keeps the comments that were passed.
        end.is_log_disabled = self.lexer.is_log_disabled;
        end.prev_error_loc = self.lexer.prev_error_loc;
        self.lexer.restore_past(&mut end, passed);
        Ok(())
"""),
])

edit('parse/type_sink.rs', [
 ("""        let comments: Vec<bun_ast::Range> = self
            .lexer
            .all_comments
            .iter()
            .skip(comments_len)
            .copied()
            .collect();
        let log = self.log();
        let (errors_after, warnings_after) = (log.errors, log.warnings);
""", """        let passed = self.lexer.comments_since(comments_len);
        let log = self.log();
        let (errors_after, warnings_after) = (log.errors, log.warnings);
"""),
 ("""        self.lexer.all_comments.extend(comments);
        end.is_log_disabled = is_log_disabled;
        end.prev_error_loc = self.lexer.prev_error_loc;
        end.all_comments_len = self.lexer.all_comments.len();
        end.comments_to_preserve_before_len = self.lexer.comments_to_preserve_before.len();
        self.lexer.restore(&end);
        let end = ts::full_start(
            self.lexer.contents,
            &self.lexer.all_comments,
            self.lexer.start as u32,
        );
""", """        end.is_log_disabled = is_log_disabled;
        end.prev_error_loc = self.lexer.prev_error_loc;
        self.lexer.restore_past(&mut end, passed);
        let end = ts::full_start(
            self.lexer.contents,
            &self.lexer.all_comments,
            self.lexer.start as u32,
        );
"""),
])

edit('parse/generics.rs', [
 ("""        let comments: Vec<bun_ast::Range> = self
            .lexer
            .all_comments
            .iter()
            .skip(comments_len)
            .copied()
            .collect();
        let log = self.log();
        let (errors_after, warnings_after) = (log.errors, log.warnings);
""", """        let passed = self.lexer.comments_since(comments_len);
        let log = self.log();
        let (errors_after, warnings_after) = (log.errors, log.warnings);
"""),
 ("""        self.lexer.all_comments.extend(comments);
        end.is_log_disabled = is_log_disabled;
        end.prev_error_loc = self.lexer.prev_error_loc;
        end.all_comments_len = self.lexer.all_comments.len();
        end.comments_to_preserve_before_len = self.lexer.comments_to_preserve_before.len();
        self.lexer.restore(&end);
""", """        end.is_log_disabled = is_log_disabled;
        end.prev_error_loc = self.lexer.prev_error_loc;
        self.lexer.restore_past(&mut end, passed);
"""),
])
print('done: add parse/comments.rs beside these edits')
