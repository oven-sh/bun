import sys
path = sys.argv[1] + '/src/js_parser/parse/parse_entry.rs'
text = open(path).read()
def rep(old, new):
    global text
    assert text.count(old) == 1, (text.count(old), old)
    text = text.replace(old, new)
# 1. one function says what a lint parse sets before its parse pass
rep('''/// `tspath.IsDeclarationFileName`: the base name ends in `.d.ts`, `.d.cts` or `.d.mts`, or in `.ts` after a `.d.`.''',
'''/// What a lint parse sets before its parse pass: the side table, and where the table of the codes starts in the log.
#[cold]
fn start_lint_parse_pass<const TS: bool>(p: &mut P<'_, TS, false>, orig_error_count: u32) {
    p.starts_for_parse_only = Some(crate::p::StartsForParseOnly::for_lint());
    p.start_syntax_errors(orig_error_count);
}

/// `tspath.IsDeclarationFileName`: the base name ends in `.d.ts`, `.d.cts` or `.d.mts`, or in `.ts` after a `.d.`.''')
# 2. the lint entry calls it
rep('''        p.starts_for_parse_only = Some(crate::p::StartsForParseOnly::for_lint());
        p.start_syntax_errors(orig_error_count);
        let parsed: Result<_, Error> = 'parse: {''',
'''        start_lint_parse_pass(p, orig_error_count);
        let parsed: Result<_, Error> = 'parse: {''')
# 3. with debug assertions, `_parse` calls it where the variable is set
rep('''        let p: &mut P<'_, TS, false> = unsafe { __p.assume_init_mut() };

        if p.options.features.hot_module_reloading {''',
'''        let p: &mut P<'_, TS, false> = unsafe { __p.assume_init_mut() };

        // With debug assertions, this variable makes the parse pass that of a lint parse: what the visit pass then prints is compared with a parse without it.
        #[cfg(debug_assertions)]
        if bun_core::getenv_z(bun_core::zstr!("BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT")).is_some() {
            start_lint_parse_pass(p, orig_error_count);
        }

        if p.options.features.hot_module_reloading {''')
open(path, 'w').write(text)
print('patched', path)
