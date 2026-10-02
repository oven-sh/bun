#!/usr/bin/env python3
"""Scratch experiment: copies <root>/ref0 to <root>/site1 (six sites of the shape `if p.lint() { cold call }` in shared
files, the predicate and the cold stub in p.rs) and to <root>/site1count (the same, each test counts its executions).
usage: mksite.py [<root>]"""
import os, shutil, sys
root = sys.argv[1] if len(sys.argv) > 1 else '/tmp/costproof/root'
SITES = [
    ('parse/parse_stmt.rs', '                    p.skip_type_script_type_stmt(&mut stmt_opts)?;\n', '                    ', 'type alias statement'),
    ('parse/parse_stmt.rs', '                    p.skip_type_script_interface_stmt(&mut stmt_opts)?;\n', '                    ', 'interface statement'),
    ('parse/parse_suffix.rs', '            p.lexer.next()?;\n            p.skip_type_script_type(Level::Lowest)?;\n\n            // These tokens are not allowed to follow a cast expression.', '            ', 'as, satisfies'),
    ('parse/mod.rs', '                    p.lexer.expect(T::TColon)?;\n                    p.skip_type_script_type(Level::Lowest)?;\n                }\n            }\n\n            if p.lexer.token == T::TEquals {', '                    ', 'annotation of a declaration'),
    ('parse/parse_fn.rs', '                    p.lexer.next()?;\n                    if !rest_arg {\n                        if p.options.features.emit_decorator_metadata', '                    ', 'annotation of a parameter'),
    ('parse/parse_fn.rs', '                p.lexer.next()?;\n\n                if p.options.features.emit_decorator_metadata\n                    && opts.allow_ts_decorators\n                    && (opts.has_argument_decorators || opts.has_decorators)\n                {\n                    func.return_ts_metadata', '                ', 'return type'),
]
PRED = '''
    /// Whether this parse fills the side table of a lint parse.
    #[inline(always)]
    pub(crate) fn lint(&self) -> bool {
        !SCAN_ONLY && self.starts_for_parse_only.is_some()
    }

    /// Stands in for the cold entry of a lint twin.
    #[cold]
    #[inline(never)]
    pub(crate) fn lint_probe(&mut self) -> crate::CrateResult<()> {
        self.lexer.next()?;
        Ok(())
    }
'''
COUNT = '''
/// Measurement only: executions of each test of the side table, by site.
pub(crate) mod seam_count {
    use core::sync::atomic::{AtomicU64, Ordering};
    pub(crate) static COUNTS: [AtomicU64; %d] = [const { AtomicU64::new(0) }; %d];
    #[inline(always)]
    pub(crate) fn hit(id: usize) {
        COUNTS[id].fetch_add(1, Ordering::Relaxed);
    }
    pub(crate) fn dump() {
        if std::env::var_os("BUN_LINT_TEST_COUNT").is_none() {
            return;
        }
        let mut line = String::from("lint-tests");
        for count in COUNTS.iter() {
            line.push(' ');
            line.push_str(&count.load(Ordering::Relaxed).to_string());
        }
        eprintln!("{line}");
    }
}
'''
def make(tag, count):
    d = root + '/' + tag
    if os.path.exists(d): shutil.rmtree(d)
    shutil.copytree(root + '/ref0', d)
    sites = []
    for k, (rel, anchor, ind, what) in enumerate(SITES):
        p = d + '/src/js_parser/' + rel; s = open(p).read()
        assert s.count(anchor) == 1, (rel, what, s.count(anchor))
        test = ('{ crate::p::seam_count::hit(%d); p.lint() }' % k) if count else 'p.lint()'
        block = ind + 'if ' + test + ' {\n' + ind + '    p.lint_probe()?;\n' + ind + '}\n'
        i = s.index(anchor); s = s[:i] + block + s[i:]
        open(p, 'w').write(s)
        sites.append((k, rel, s.count('\n', 0, i) + 1, what))
    p = d + '/src/js_parser/p.rs'; s = open(p).read()
    a = '    pub(crate) fn mark_expr_as_parenthesized(&mut self, expr: &mut Expr) {\n'
    assert s.count(a) == 1
    i = s.index(a); s = s[:i] + PRED.lstrip('\n') + '\n' + s[i:]
    if count:
        i = s.index('\nimpl<'); s = s[:i] + (COUNT % (len(SITES), len(SITES))) + s[i:]
        a = "> Drop for P<'a, TYPESCRIPT, SCAN_ONLY> {\n    fn drop(&mut self) {\n"
        assert s.count(a) == 1
        s = s.replace(a, a + '        seam_count::dump();\n')
    open(p, 'w').write(s)
    with open(d + '/sites.tsv', 'w') as f:
        for k, rel, ln, what in sites: f.write('%d\t%s:%d\t%s\t%s\n' % (k, rel, ln, '-', what))
    print(tag, len(sites), 'sites')
make('site1', False)
make('site1count', True)
