import sys
root = sys.argv[1]
def patch(rel, pairs):
    path = root + '/src/js_parser/' + rel
    text = open(path).read()
    for old, new in pairs:
        assert text.count(old) == 1, (rel, text.count(old), old)
        text = text.replace(old, new)
    open(path, 'w').write(text)
    print('patched', path)
# one place says what a lint parse sets before its parse pass
patch('p.rs', [('''    /// Whether `Parser::parse_for_lint` runs this parse.
    #[inline]
    pub(crate) fn is_lint_parse(&self) -> bool {''',
'''    /// What a lint parse sets before its parse pass: the side table, and where the table of the codes starts in the log.
    #[cold]
    pub(crate) fn start_lint_parse_pass(&mut self, orig_error_count: u32) {
        self.starts_for_parse_only = Some(StartsForParseOnly::for_lint());
        self.start_syntax_errors(orig_error_count);
    }

    /// Whether `Parser::parse_for_lint` runs this parse.
    #[inline]
    pub(crate) fn is_lint_parse(&self) -> bool {''')])
patch('parse/parse_entry.rs', [
('''        p.starts_for_parse_only = Some(crate::p::StartsForParseOnly::for_lint());
        p.start_syntax_errors(orig_error_count);
        let parsed: Result<_, Error> = 'parse: {''',
'''        p.start_lint_parse_pass(orig_error_count);
        let parsed: Result<_, Error> = 'parse: {'''),
('''        let p: &mut P<'_, TS, false> = unsafe { __p.assume_init_mut() };

        if p.options.features.hot_module_reloading {''',
'''        let p: &mut P<'_, TS, false> = unsafe { __p.assume_init_mut() };

        // With debug assertions, this variable gives the parse pass the side table of a lint parse: what the visit pass then prints is compared with a parse without it.
        #[cfg(debug_assertions)]
        if bun_core::getenv_z(bun_core::zstr!("BUN_DEBUG_TEST_LINT_PARSE_THEN_VISIT")).is_some() {
            p.start_lint_parse_pass(orig_error_count);
        }

        if p.options.features.hot_module_reloading {'''),
])
