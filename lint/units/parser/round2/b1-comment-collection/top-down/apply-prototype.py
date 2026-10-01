#!/usr/bin/env python3
# usage: python3 apply-prototype.py <path to a copy of src/js_parser at be1ebe5295>
# Applies the edits that the probes of this directory were run with: the lexer mode, the two JSX arms, the comments
# before the first token, the five places that move the lexer ahead, the table on the side table.
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
 ("""#[derive(Clone, Copy)]
pub struct ScanResult<'a> {
    pub(crate) token: T,
    pub(crate) contents: &'a [u8],
}
""", """#[derive(Clone, Copy)]
pub struct ScanResult<'a> {
    pub(crate) token: T,
    pub(crate) contents: &'a [u8],
}

/// Which comments `Lexer::all_comments` gets.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum TrackComments {
    /// None.
    Off = 0,
    /// Those that `next()` reads: what the character frequency of a minified build subtracts.
    ForCharFreq = 1,
    /// Every comment of the file, those inside a JSX tag too: a lint parse.
    All = 2,
}

impl TrackComments {
    #[inline]
    pub(crate) const fn for_char_freq(minify_identifiers: bool) -> TrackComments {
        if minify_identifiers {
            TrackComments::ForCharFreq
        } else {
            TrackComments::Off
        }
    }
}

const _: () = assert!(core::mem::size_of::<Lexer<'static>>() == 336);
const _: () = assert!(core::mem::size_of::<LexerSnapshot<'static>>() == 240);
"""),
 ("    pub(crate) track_comments: bool,\n    pub(crate) track_react_suppressions: bool,\n    // Vec buffer lengths",
  "    pub(crate) track_comments: TrackComments,\n    pub(crate) track_react_suppressions: bool,\n    // Vec buffer lengths"),
 ("    pub(crate) track_comments: bool,\n    pub(crate) track_react_suppressions: bool,\n    /// `@name`",
  "    pub(crate) track_comments: TrackComments,\n    pub(crate) track_react_suppressions: bool,\n    /// `@name`"),
 ("        if self.track_comments {\n", "        if self.track_comments != TrackComments::Off {\n"),
 ("            track_comments: false,\n", "            track_comments: TrackComments::Off,\n"),
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
                            if self.track_comments == TrackComments::All {
                                self.push_comment_in_jsx_tag();
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
                            if self.track_comments == TrackComments::All {
                                self.push_comment_in_jsx_tag();
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

    /// The comment that `next_inside_jsx_element` read goes to the list of a lint parse.
    #[cold]
    #[inline(never)]
    fn push_comment_in_jsx_tag(&mut self) {
        self.all_comments.push(self.range());
    }

    /// Every comment goes to `all_comments` from here on. `primed` is how the first token was read: where no comment was kept, the comments before it are read again.
    #[cold]
    #[inline(never)]
    pub(crate) fn track_all_comments(&mut self, primed: TrackComments) {
        self.track_comments = TrackComments::All;
        if primed != TrackComments::Off || self.start == 0 {
            return;
        }
        let mut log = Log::default();
        let mut again = Lexer::init_without_reading(&mut log, self.source, self.arena);
        again.track_comments = TrackComments::All;
        again.jsc_builtin_syntax = self.jsc_builtin_syntax;
        again.step();
        let _ = again.next();
        self.all_comments = core::mem::take(&mut again.all_comments);
    }

    /// The comments read since the list held `len`, for a caller that takes the lexer back and then moves it past them with `restore_past`. None unless every comment is tracked.
    #[cold]
    #[inline(never)]
    pub(crate) fn comments_since(&self, len: usize) -> Vec<Range> {
        if self.track_comments != TrackComments::All {
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
 ("        lexer.track_comments = opts.features.minify_identifiers;\n",
  "        lexer.track_comments =\n            js_lexer::TrackComments::for_char_freq(opts.features.minify_identifiers);\n"),
 ("    /// `Parser::parse_for_lint` made it: `Parser::parse_only` keeps no parentheses.\n    pub(crate) is_lint: bool,\n",
  "    /// Every comment of a lint-parsed file, in source order.\n    pub comments: crate::parse::comments::Comments,\n    /// `Parser::parse_for_lint` made it: `Parser::parse_only` keeps no parentheses.\n    pub(crate) is_lint: bool,\n"),
])

edit('parse/parse_entry.rs', [
 ("        lexer.track_comments = options.features.minify_identifiers;\n",
  "        lexer.track_comments =\n            js_lexer::TrackComments::for_char_freq(options.features.minify_identifiers);\n"),
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
        p.lexer.track_all_comments(primed);
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
