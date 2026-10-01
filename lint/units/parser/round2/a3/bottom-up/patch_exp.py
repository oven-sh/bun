import sys
path = sys.argv[1] + '/src/js_parser/parse/parse_entry.rs'
text = open(path).read()
def rep(old, new, count=1):
    global text
    assert text.count(old) == count, (text.count(old), old)
    text = text.replace(old, new)
# 1. after init_p! in _parse: the lint side table when the switch is on
rep('''        let p: &mut P<'_, TS, false> = unsafe { __p.assume_init_mut() };

        if p.options.features.hot_module_reloading {''',
'''        let p: &mut P<'_, TS, false> = unsafe { __p.assume_init_mut() };
        let lint_switch = bun_core::getenv_z(bun_core::zstr!("BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT"));
        let lint_then_visit = lint_switch.is_some();
        if lint_then_visit {
            p.starts_for_parse_only = Some(crate::p::StartsForParseOnly::for_lint());
            p.start_syntax_errors(orig_error_count);
        }

        if p.options.features.hot_module_reloading {''')
# 2. the statement options: ambient for a declaration file, or forced by the value `ambient`
rep('''        // Parse the file in the first pass, but do not bind symbols
        let mut opts = ParseStatementOptions {
            scope: StatementScope::Module,
            ..Default::default()
        };
        let mut parse_tracer = bun_core::perf::trace("JSParser::parse");''',
'''        // Parse the file in the first pass, but do not bind symbols
        let mut opts = ParseStatementOptions {
            scope: StatementScope::Module,
            is_typescript_declare: lint_then_visit
                && TS
                && (is_declaration_file_name(source.path.text) || lint_switch == Some(&b"ambient"[..])),
            ..Default::default()
        };
        let mut parse_tracer = bun_core::perf::trace("JSParser::parse");''')
# 3. before the visit pass: the side table goes (value `keep` leaves it)
rep('''        let mut visit_tracer = bun_core::perf::trace("JSParser::visit");
        p.prepare_for_visit_pass()?;''',
'''        if lint_then_visit && lint_switch != Some(&b"keep"[..]) {
            drop(p.starts_for_parse_only.take());
        }
        let mut visit_tracer = bun_core::perf::trace("JSParser::visit");
        p.prepare_for_visit_pass()?;''')
open(path, 'w').write(text)
print('patched', path)
