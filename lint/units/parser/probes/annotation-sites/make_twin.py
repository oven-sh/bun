#!/usr/bin/env python3
"""Prints the body that parse_paren_expr_for_lint must have, derived from parse_paren_expr in src/js_parser/parse/mod.rs.
usage: make_twin.py [<path of mod.rs>]      (default /workspace/wt/parser/src/js_parser/parse/mod.rs)
The differences are the ones that annotation_tests.rs lists in TWIN_DIFFERENCES: a change of one needs the same change here.
Compare:  diff <(sed -n '/    pub(crate) fn parse_paren_expr_for_lint(/,/^    }$/p' mod.rs) <(python3 make_twin.py | cat -s)"""
import sys
path = sys.argv[1] if len(sys.argv) > 1 else '/workspace/wt/parser/src/js_parser/parse/mod.rs'
src = open(path).read()
start = src.index('    pub(crate) fn parse_paren_expr(\n')
end = src.index('\n    }\n', start) + len('\n    }\n')
body = '\n'.join(l for l in src[start:end].split('\n') if not l.strip().startswith('//'))
def rep(old, new):
    global body
    assert body.count(old) == 1, (body.count(old), old)
    body = body.replace(old, new)
rep('    pub(crate) fn parse_paren_expr(\n', '    pub(crate) fn parse_paren_expr_for_lint(\n')
rep('        let mut arrow_arg_errors = DeferredArrowArgErrors::default();\n', '        let arrow_arg_errors = DeferredArrowArgErrors::default();\n')
rep('                p.skip_type_script_type(Level::Lowest)?;\n', '                p.lint_type_annotation(arrow_parameter_loc(item))?;\n')
rep('''                if opts.is_after_question_and_before_colon {
                    is_arrow_fn = p
                        .is_type_script_arrow_return_type_after_question_and_before_colon(
                            &arrow_data,
                        )?;
                    if is_arrow_fn {
                        p.lexer.next()?;
                        p.skip_typescript_return_type()?;
                    }
                } else {
                    is_arrow_fn = p.try_skip_type_script_arrow_return_type_with_backtracking();
                }
''', '''                is_arrow_fn = p.lint_arrow_return_type(
                    loc,
                    &arrow_data,
                    opts.is_after_question_and_before_colon,
                )?;
''')
rep('                p.log_arrow_arg_errors(&mut arrow_arg_errors);\n', '                log_arrow_arg_errors_for_lint(p.log(), p.source, arrow_arg_errors);\n')
rep('        p.pop_and_flatten_scope(scope_index);\n', '        pop_and_flatten_scope_for_lint(&mut p.current_scope, &mut p.scopes_in_order, scope_index);\n')
rep('            if opts.is_async {\n            }\n', '')
sys.stdout.write(body)
