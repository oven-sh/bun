import sys
path = sys.argv[1] + '/src/js_parser/parse/parse_entry.rs'
text = open(path).read()
old = '''        let p: &mut P<'_, TS, false> = unsafe { __p.assume_init_mut() };

        if p.options.features.hot_module_reloading {'''
new = '''        let p: &mut P<'_, TS, false> = unsafe { __p.assume_init_mut() };

        // With debug assertions, this variable gives the parse pass the side table of a lint parse: what the visit pass then prints is compared with a parse without it.
        #[cfg(debug_assertions)]
        if bun_core::getenv_z(bun_core::zstr!("BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT")).is_some() {
            p.starts_for_parse_only = Some(crate::p::StartsForParseOnly::for_lint());
            p.start_syntax_errors(orig_error_count);
        }

        if p.options.features.hot_module_reloading {'''
assert text.count(old) == 1
open(path, 'w').write(text.replace(old, new))
print('patched', path)
