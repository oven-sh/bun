# Compares, for every function of checker.go that steps 6 to 8 port, the calls of methods of the checker in upstream's body
# with the calls in the Rust body: the same calls the same number of times. An ORDER DIFF line is a nested call of upstream
# (`c.a(c.b(x))` reads a, b and runs b, a) that the Rust code writes as two statements.
# usage (from src/typecheck): callseq.py
import re, sys
# Upstream passes the method as a value (no call in its text), or calls it only inside the message of a panic.
KNOWN = {'getLateBoundSymbol': ({}, {'has_late_bindable_name': 1}), 'resolveAlias': ({'symbol_to_string': 1}, {})}
def snake(n):
    s=re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1_\2', n)
    s=re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', s)
    return s.lower()
go = open('/workspace/ref/typescript-go/internal/checker/checker.go').read().split('\n')
# collect Go functions in ranges
ranges = [(2182,2200),(13991,14050),(14170,16493)]
go_funcs = {}
for lo,hi in ranges:
    i = lo-1
    while i < hi:
        m = re.match(r'func (?:\(c \*Checker\) )?([A-Za-z0-9_]+)\(', go[i])
        if m:
            name = m.group(1)
            j = i+1
            while j < len(go) and go[j] != '}':
                j += 1
            body = '\n'.join(go[i+1:j])
            go_funcs[name] = body
            i = j
        i += 1
rs = ''
for f in ['c04_name_resolution_hooks.rs','c21_resolved_symbols_diagnostics.rs','c22_symbols_merge.rs','c23_alias_targets.rs','c24_external_modules.rs','c25_entity_names.rs','c26_exports_late_binding.rs','c27_resolve_alias.rs']:
    rs += open('checker/'+f).read() + '\n'
# split Rust functions by "pub fn name" at 4-space or 0 indent
rs_funcs = {}
for m in re.finditer(r'^( {0,8})(?:pub )?fn ([a-z0-9_]+)', rs, re.M):
    indent = m.group(1); name = m.group(2)
    start = m.end()
    # find end: line that equals indent + '}'
    endm = re.search(r'^%s\}' % indent, rs[start:], re.M)
    body = rs[start:start+endm.start()] if endm else rs[start:]
    rs_funcs.setdefault(name, body)
skip_rs = {'map_set','fail','fail_detail','assert','stack_limit','list_of','list','text','loop_limit','value_symbol_links_get','stand_in','bad_cast','is_nil','as_structured_type','create_diagnostic_for_node','new_diagnostic_for_node','new_diagnostic_chain_for_node'}
skip_go = {'error' if False else ''}
special = {'ResolveAlias':'resolve_alias_exported','GetAmbientModules':'get_ambient_modules'}
bad = 0
for name, body in go_funcs.items():
    rname = special.get(name, snake(name))
    if rname not in rs_funcs:
        print('NO RUST FN', name, rname); bad += 1; continue
    gseq = [snake(x) for x in re.findall(r'\bc\.([A-Za-z0-9_]+)\(', body)]
    rbody = rs_funcs[rname]
    rseq = [x for x in re.findall(r'\b(?:self|c)\s*\.\s*([a-z0-9_]+)\(', rbody) if x not in skip_rs]
    if sorted(gseq) != sorted(rseq):
        from collections import Counter
        cg, cr = Counter(gseq), Counter(rseq)
        if KNOWN.get(name) == (dict(cg - cr), dict(cr - cg)):
            continue
        print('MULTISET DIFF', name)
        print('   go-only:', dict(cg - cr)); print('   rs-only:', dict(cr - cg)); bad += 1
    elif gseq != rseq:
        print('ORDER DIFF', name)
        print('   go:', gseq); print('   rs:', rseq)
print('functions', len(go_funcs), 'bad', bad)
