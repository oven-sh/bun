#!/usr/bin/env python3
"""Patched copies of src/js_parser (head be1ebe5295) for the combined zero-cost measurement of pass 1b (a2-zero-cost).
usage: ROOT=/tmp/a2zc/seam/root myvar.py <variant> ...      copies go to $ROOT/<variant>/src/js_parser; nothing is written into the worktree
  all        vold + bt + f1 of the sibling unit (round2/zero-cost-measure/top-down/variants.py, copied here as sib.py) and the edits of mine()
  allnolint  all, and every test of the side table compiled out (sib.nolint): what remains against the base is not the side table"""
import os, sys
os.environ.setdefault('ROOT', '/tmp/a2zc/seam/root')
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sib

def mine(t):
    F = 'parse/parse_skip_typescript.rs'
    # M1: no keyword lookup and no token read ahead where a statement starts with an identifier
    t.rep('parse/parse_stmt.rs', """        if Self::IS_TYPESCRIPT_ENABLED
            && is_identifier
            && let Some(keyword) = js_lexer::TypescriptStmtKeyword::from_bytes(name)
            && let Some(stmt) = Self::parse_stmt_named_like_cast(p, opts, loc, keyword)?
        {
            return Ok(stmt);
        }
""", "")
    # M2: a return type is read as any other type; the predicate about a parameter named like a type operator is left to the rare arms
    t.rep(F, """        // "function f(keyof: any): keyof is string"
        if self.lexer.token == T::TIdentifier
            && self.is_followed_by_is_keyword()
            && self.skip_type_script_predicate_of_keyword_name()?
        {
            return Ok(());
        }
        self.skip_type_script_type_with_opts::<Discard>(""", """        self.skip_type_script_type_with_opts::<Discard>(""")
    # M3: the parameters of a signature as the base read them (R2 and R3 of the A1 classes are rejected again)
    t.rep(F, """            let is_identifier = self.lexer.token == T::TIdentifier;
            let name = self.lexer.identifier;
            self.skip_type_script_binding()?;

            // "(public a)"
            if is_identifier && self.lexer.token == T::TIdentifier {
                self.skip_type_script_parameter_modifiers(name)?;
            }
""", """            self.skip_type_script_binding()?;
""")
    t.rep(F, """            // "(a = 1)"
            if self.lexer.token == T::TEquals {
                self.parse_initializer_in_type()?;
            }

            // "(a, b)"
""", """            // "(a, b)"
""")
    # M4: only a constructor reads modifiers before a parameter
    t.rep('parse/parse_fn.rs', "                if is_identifier && (opts.is_constructor || !rest_arg) {", "                if is_identifier && opts.is_constructor {")
    # M5: the comma after a rest parameter is only looked for where a body may be missing
    t.rep('parse/parse_fn.rs', """        if opts.allow_missing_body_for_type_script && p.lexer.token != T::TOpenBrace {
            p.lexer.expect_or_insert_semicolon()?;
            func.flags.insert(Flags::Function::IsForwardDeclaration);
            return Ok(func);
        }
        if rest_comma.len > 0 {
            p.log().add_range_error(
                Some(p.source),
                rest_comma,
                b"Expected \\")\\" but found \\",\\"",
            );
        }
""", """        if opts.allow_missing_body_for_type_script {
            if p.lexer.token != T::TOpenBrace {
                p.lexer.expect_or_insert_semicolon()?;
                func.flags.insert(Flags::Function::IsForwardDeclaration);
                return Ok(func);
            }
            if rest_comma.len > 0 {
                p.log().add_range_error(
                    Some(p.source),
                    rest_comma,
                    b"Expected \\")\\" but found \\",\\"",
                );
            }
        }
""")
    # M6: "[" of a class member is read as the base read it (the index signature is told after the name)
    t.rep('parse/parse_property.rs', """                    if Self::IS_TYPESCRIPT_ENABLED && opts.is_class && p.is_class_index_signature()
                    {
                        p.skip_class_index_signature()?;

                        // Skip this property entirely
                        return Ok(None);
                    }

""", "")
    # M7: the test of the token after the tag of a JSX element is the one of the base
    t.rep('parse/parse_jsx.rs', """        if TYPESCRIPT && matches!(p.lexer.token, T::TLessThan | T::TLessThanLessThan) {
            if p.starts_for_parse_only.is_some() {
                p.lint_jsx_type_arguments(loc)?;
            } else {
                // Pass a flag to the type argument skipper because we need to call
                let _ = p.skip_type_script_type_arguments::<true, false>()?;
            }
        }
""", """        if TYPESCRIPT
            && matches!(
                p.lexer.token,
                T::TLessThan | T::TLessThanEquals | T::TLessThanLessThan | T::TLessThanLessThanEquals
            )
        {
            if p.starts_for_parse_only.is_some() && matches!(p.lexer.token, T::TLessThan | T::TLessThanLessThan) {
                p.lint_jsx_type_arguments(loc)?;
            } else {
                // Pass a flag to the type argument skipper because we need to call
                let _ = p.skip_type_script_type_arguments::<true, false>()?;
            }
        }
""")
    # M8: the heritage clauses and the members of an interface as the base read them
    t.rep(F, """        self.parse_heritage_clauses()?;
        self.parse_object_type_members()
    }
""", """        if self.lexer.token == T::TExtends {
            self.lexer.next()?;

            loop {
                self.skip_type_script_type(Level::Lowest)?;
                if self.lexer.token != T::TComma {
                    break;
                }
                self.lexer.next()?;
            }
        }

        if self.lexer.is_contextual_keyword(b"implements") {
            self.lexer.next()?;
            loop {
                self.skip_type_script_type(Level::Lowest)?;
                if self.lexer.token != T::TComma {
                    break;
                }
                self.lexer.next()?;
            }
        }

        self.skip_type_script_object_type()?;
        Ok(())
    }
""")
    return {'mine': 9}

def f1_ext(t):
    c = sib.f1(t)
    # the grammar of the base that vold adds has two checks of the bound too
    import re
    f = 'parse/old_skip.rs'
    if os.path.exists(t.dir + '/' + f):
        s = t.read(f)
        s2, k = re.subn(r'if !self\.stack_check\.is_safe_to_recurse\(\) \{\n(\s*)return Err\((crate::)?Error::StackOverflow\);', lambda m: 'if !self.stack_check.is_safe_to_recurse() && !self.is_lint_stack_safe() {\n%sreturn Err(%sError::StackOverflow);' % (m.group(1), m.group(2) or ''), s)
        t.write(f, s2); c['old stack checks'] = k
    return c

def attempts(t):
    F = 'parse/parse_skip_typescript.rs'
    # inside an attempt the grammar of the base decides alone: a comparison `a < b` is not read twice
    t.rep(F, """        if matches!(err, Error::StackOverflow | Error::Alloc(_)) {
            return Err(err);
        }
        self.rewind_to_read_mark(mark);""", """        if matches!(err, Error::StackOverflow | Error::Alloc(_)) || self.lexer.is_log_disabled {
            return Err(err);
        }
        self.rewind_to_read_mark(mark);""", count=4)
    t.rep(F, "        if self.skip_type_script_type_arguments::<false, true>()? {", "        if self.old_skip_type_script_type_arguments::<false, true>()? {")
    return {'attempts': 5}

def gate(t):
    # the test at "(" stays, for TypeScript only: the stack-bound seam (sib.f1) measured +1,838,620 Bc in js-control
    t.rep('parse/parse_prefix.rs', "        if !SCAN_ONLY && p.is_lint_parse() {\n            return Self::pfx_t_open_paren_for_lint(p, loc, level, flags);", "        if Self::IS_TYPESCRIPT_ENABLED && !SCAN_ONLY && p.is_lint_parse() {\n            return Self::pfx_t_open_paren_for_lint(p, loc, level, flags);")
    return {'gate': 1}

def v_all(t):
    return [sib.vold(t), attempts(t), sib.bt(t), mine(t), gate(t)]
def v_allnolint(t):
    return [sib.vold(t), attempts(t), sib.bt(t), mine(t), gate(t), sib.nolint(t)]
def v_allf1(t):
    return [sib.vold(t), sib.bt(t), mine(t), f1_ext(t)]
def v_voldmine(t):
    return [sib.vold(t), sib.bt(t), mine(t)]

V = {'all': v_all, 'allnolint': v_allnolint, 'allf1': v_allf1, 'voldmine': v_voldmine}
if __name__ == '__main__':
    for tag in sys.argv[1:]:
        t = sib.Tree(tag); print(tag, V[tag](t))
