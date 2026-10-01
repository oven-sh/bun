#!/usr/bin/env python3
"""Applies the plan of b1-directives-pragmas to a COPY of src/js_parser. usage: apply.py <copy of src/js_parser> <dir with comment_directives.rs and pragmas.rs>"""
import sys, pathlib, shutil
root = pathlib.Path(sys.argv[1]); new = pathlib.Path(sys.argv[2])

def edit(rel, old, new_text, count=1):
    p = root / rel
    s = p.read_text()
    if s.count(old) != count:
        sys.exit(f"{rel}: {s.count(old)} matches of {old!r}")
    p.write_text(s.replace(old, new_text))

shutil.copy(new / "comment_directives.rs", root / "parse/comment_directives.rs")
shutil.copy(new / "pragmas.rs", root / "parse/pragmas.rs")

# 1. The two modules.
edit("parse/mod.rs", "pub mod attached;\npub mod erased;\n", "pub mod attached;\npub mod comment_directives;\npub mod erased;\n")
edit("parse/mod.rs", "pub(crate) mod parse_typescript;\npub mod syntax_errors;\n", "pub(crate) mod parse_typescript;\npub mod pragmas;\npub mod syntax_errors;\n")

# 2. The side table.
edit("p.rs", """    pub generics: crate::parse::generics::Generics,
    /// What the reference reports for the syntax errors of a lint parse, while the parse runs.
""", """    pub generics: crate::parse::generics::Generics,
    /// The `@ts-ignore` and `@ts-expect-error` comments of the file, in the order of the source.
    pub comment_directives: Vec<crate::parse::comment_directives::CommentDirective>,
    /// What the comments before the first token say of the file: what it refers to, and whether it is checked.
    pub pragmas: crate::parse::pragmas::Pragmas,
    /// What the reference reports for the syntax errors of a lint parse, while the parse runs.
""")

# 3. The two diagnostics, and the helper that logs one at a range (the helper is the one of b2-codes-on-msg).
edit("parse/syntax_errors.rs", """/// `Expression_expected`
""", """/// `Invalid_reference_directive_syntax`
pub(crate) const INVALID_REFERENCE_DIRECTIVE_SYNTAX: Message =
    Message::new(1084, b"Invalid 'reference' directive syntax.");
/// `Expression_expected`
""")
edit("parse/syntax_errors.rs", """/// What the reference reports for one message that a lint parse left in the log.
""", """/// `X_resolution_mode_should_be_either_require_or_import`
pub(crate) const X_RESOLUTION_MODE_SHOULD_BE_EITHER_REQUIRE_OR_IMPORT: Message = Message::new(
    1453,
    b"`resolution-mode` should be either `require` or `import`.",
);

/// What the reference reports for one message that a lint parse left in the log.
""")
edit("parse/syntax_errors.rs", """        // The reference marks the node from the end of the token before it.
        let start = ts::full_start(self.lexer.contents, &self.lexer.all_comments, node.start);
        let range = ts::range(start, node.end);
        if self.lexer.prev_error_loc.eql(range.loc) {
            return;
        }
        let msgs_len = self.log().msgs.len();
        self.log()
            .add_range_error(Some(self.source), range, message.text);
        self.lexer.prev_error_loc = range.loc;
        self.code_syntax_error(msgs_len, message, b"", range);
    }
""", """        // The reference marks the node from the end of the token before it.
        let start = ts::full_start(self.lexer.contents, &self.lexer.all_comments, node.start);
        self.syntax_error_as(ts::range(start, node.end), message, b"");
    }

    /// Logs, in a lint parse, the diagnostic `message` of the reference at `range`, `argument` in its text. False in a parse without lint, which logs nothing here.
    #[cold]
    #[inline(never)]
    pub(crate) fn syntax_error_as(
        &mut self,
        range: Range,
        message: Message,
        argument: &[u8],
    ) -> bool {
        if !self.is_lint_parse() {
            return false;
        }
        // One error for one place, as the lexer reports.
        if self.lexer.prev_error_loc.eql(range.loc) {
            return true;
        }
        let msgs_len = self.log().msgs.len();
        self.log().add_range_error_with_code(
            Some(self.source),
            range,
            message.code,
            message.format(argument),
            Box::default(),
        );
        self.lexer.prev_error_loc = range.loc;
        self.code_syntax_error(msgs_len, message, argument, range);
        true
    }
""")

# 4. The two calls of the entry.
edit("parse/parse_entry.rs", """                break 'parse Err(err.into());
            }
            if p.log().errors > orig_error_count {
                break 'parse Err(crate::Error::SyntaxError);
            }
            let mut opts = ParseStatementOptions {
                scope: StatementScope::Module,
                is_typescript_declare: is_declaration_file,
""", """                break 'parse Err(err.into());
            }
            // The lexer is on the first token: every comment that can hold a pragma is read.
            p.read_pragmas_for_lint();
            if p.log().errors > orig_error_count {
                break 'parse Err(crate::Error::SyntaxError);
            }
            let mut opts = ParseStatementOptions {
                scope: StatementScope::Module,
                is_typescript_declare: is_declaration_file,
""")
edit("parse/parse_entry.rs", """        sidecar.attached.sort();
        Ok(f(&ParsedForLint {
""", """        sidecar.attached.sort();
        sidecar.comment_directives = crate::parse::comment_directives::get_comment_directives(
            p.lexer.contents,
            &p.lexer.all_comments,
        );
        Ok(f(&ParsedForLint {
""")
print("applied to", root)
