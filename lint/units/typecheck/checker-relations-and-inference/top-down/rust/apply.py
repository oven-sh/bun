# Copies the conventions scratch to a work directory and adds the module of this directory to it.
# usage: apply.py <conventions-scratch/rust> <work dir> <fn7_relater.rs>
import shutil, sys
src, dst, proto = sys.argv[1:4]
shutil.rmtree(dst, ignore_errors=True)
shutil.copytree(src, dst)
shutil.copy(proto, dst + '/fn7_relater.rs')
def edit(name, pairs):
    p = dst + '/' + name
    s = open(p).read()
    for a, b in pairs:
        if a not in s:
            sys.exit(name + ': pattern not found: ' + a[:60])
        s = s.replace(a, b, 1)
    open(p, 'w').write(s)
edit('conv.rs', [('pub mod fn6_binder;\n', 'pub mod fn6_binder;\npub mod fn7_relater;\n')])
edit('checker.rs', [('    pub resolving_explicit_type_of_symbol: Vec<SymbolId>,\n}', "    pub resolving_explicit_type_of_symbol: Vec<SymbolId>,\n    pub rel: crate::fn7_relater::RelationsAndInference<'a>,\n}")])
edit('tests.rs', [
    ('        resolving_explicit_type_of_symbol: Vec::new(),\n', '        resolving_explicit_type_of_symbol: Vec::new(),\n        rel: Default::default(),\n'),
    ("fn checker<'a>(", "pub(crate) fn checker<'a>("),
    ('fn program() ->', 'pub(crate) fn program() ->'),
])
