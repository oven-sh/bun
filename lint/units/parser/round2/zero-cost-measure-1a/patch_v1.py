#!/usr/bin/env python3
"""V1: the fixes outside the structure of the type grammar, on a copy of src/js_parser. usage: patch_v1.py <root>"""
import sys, re
root = sys.argv[1] + '/src/js_parser/'
def sub(path, old, new, count=1):
    s = open(root + path).read()
    assert s.count(old) == count, (path, old[:60], s.count(old))
    open(root + path, 'w').write(s.replace(old, new))

# 1. "(" of an expression: JavaScript does not test for a lint parse
sub('parse/parse_prefix.rs',
    "        if !SCAN_ONLY && p.is_lint_parse() {\n            return Self::pfx_t_open_paren_for_lint(p, loc, level, flags);",
    "        if Self::IS_TYPESCRIPT_ENABLED && !SCAN_ONLY && p.is_lint_parse() {\n            return Self::pfx_t_open_paren_for_lint(p, loc, level, flags);")

# 2. statement named like a cast: no token is read ahead where the statement starts (stand-in: the test moves behind the cast)
sub('parse/parse_stmt.rs',
    """        if Self::IS_TYPESCRIPT_ENABLED
            && is_identifier
            && let Some(keyword) = js_lexer::TypescriptStmtKeyword::from_bytes(name)
            && let Some(stmt) = Self::parse_stmt_named_like_cast(p, opts, loc, keyword)?
        {
            return Ok(stmt);
        }
""", "")

# 3. attempts: no mark of the side table, the log is cut only where it grew
old_bool = """        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        let log = self.log();
        let (old_msgs_len, old_errors, old_warnings) = (log.msgs.len(), log.errors, log.warnings);
        let recorded = self.sidecar_mark();
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
            // What the attempt logged without asking the lexer goes with it.
            let log = self.log();
            log.msgs.truncate(old_msgs_len);
            log.errors = old_errors;
            log.warnings = old_warnings;
            if let Some(mark) = recorded {
                self.rewind_sidecar(mark);
            }
        }
"""
new_bool = """        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        let old_msgs_len = self.log().msgs.len();
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
            if self.log().msgs.len() != old_msgs_len {
                self.cut_attempt_log(old_msgs_len);
            }
        }
"""
sub('parse/parse_skip_typescript.rs', old_bool, new_bool)
old_res = """        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        let log = self.log();
        let (old_msgs_len, old_errors, old_warnings) = (log.msgs.len(), log.errors, log.warnings);
        let recorded = self.sidecar_mark();
        self.lexer.is_log_disabled = true;
        let mut backtrack = false;
        let result = match func(self) {
            Ok(r) => r,
            Err(_) => {
                backtrack = true;
                SkipTypeParameterResult::DidNotSkipAnything
            }
        };

        if backtrack {
            self.lexer.restore(&old_lexer);
            // `<out T>x`: the modifier that no type parameter of a function has is logged past the lexer
            let log = self.log();
            log.msgs.truncate(old_msgs_len);
            log.errors = old_errors;
            log.warnings = old_warnings;
            if let Some(mark) = recorded {
                self.rewind_sidecar(mark);
            }
        }
"""
new_res = """        let old_lexer = self.lexer.snapshot();
        let old_log_disabled = self.lexer.is_log_disabled;
        let old_msgs_len = self.log().msgs.len();
        self.lexer.is_log_disabled = true;
        let mut backtrack = false;
        let result = match func(self) {
            Ok(r) => r,
            Err(_) => {
                backtrack = true;
                SkipTypeParameterResult::DidNotSkipAnything
            }
        };

        if backtrack {
            self.lexer.restore(&old_lexer);
            if self.log().msgs.len() != old_msgs_len {
                self.cut_attempt_log(old_msgs_len);
            }
        }
"""
sub('parse/parse_skip_typescript.rs', old_res, new_res)
sub('parse/parse_skip_typescript.rs',
    """    /// As `lexer_backtracker_bool`, and what `func` returned where nothing went back.""",
    """    /// Drops what an attempt that failed logged without asking the lexer. The counts are the ones of what stays.
    #[cold]
    #[inline(never)]
    fn cut_attempt_log(&mut self, len: usize) {
        let log = self.log();
        log.msgs.truncate(len);
        let mut errors = 0u32;
        let mut warnings = 0u32;
        for msg in log.msgs.iter() {
            match msg.kind {
                bun_ast::Kind::Err => errors += 1,
                bun_ast::Kind::Warn => warnings += 1,
                _ => {}
            }
        }
        log.errors = errors;
        log.warnings = warnings;
    }

    /// As `lexer_backtracker_bool`, and what `func` returned where nothing went back.""")

# 4. index signature of a class: no token is read ahead at "[" (stand-in: the test moves behind the expression)
sub('parse/parse_property.rs',
    """                    if Self::IS_TYPESCRIPT_ENABLED && opts.is_class && p.is_class_index_signature()
                    {
                        p.skip_class_index_signature()?;

                        // Skip this property entirely
                        return Ok(None);
                    }

""", "")
print('v1 patched')
