#!/usr/bin/env python3
# For each function of checker/emitresolver.go and its translation in checker/emitresolver.rs: the calls of methods of
# the checker (`r.checker.name(` and `c.name(` upstream, `c.name(` and `self.name(` of the method of the checker here),
# the calls of methods of the resolver (`r.name(` upstream, `self.name(c` here) and the calls of free functions
# (`ast.Name(`, `core.Name(` and the free functions of the package upstream, `name(a, ...)` and `name(c, ...)` here), by
# name and number. A line is "same" when both sides agree; else it lists the names that differ with the two counts
# (upstream, here). It compares names and counts, not arguments and not order. usage: emitresolver-callseq.py
import collections
import re

GO = '/workspace/ref/typescript-go/internal/checker/emitresolver.go'
RS = '/workspace/wt/typecheck/src/typecheck/checker/emitresolver.rs'
# Helpers of the port that stand for a Go operation and not for a call of upstream.
HELPERS = ['fail', 'stack_limit', 'list_of', 'text', 'as_literal_type', 'stand_in']
# The exported function of a pair that has one name in snake_case (node-table-id-contract, snake-collisions.txt).
EXPORTED = ['IsOptionalParameter', 'IsDeclarationVisible', 'IsEntityNameVisible', 'RequiresAddingImplicitUndefined',
            'IsSymbolAccessible']
# An exported wrapper of exports.go is the method that it wraps.
WRAPPERS = {'get_effective_declaration_flags': 'get_effective_declaration_flags',
            'get_resolution_mode_override': 'get_resolution_mode_override'}


def snake(name):
    s = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1_\2', name)
    s = re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', s)
    return s.lower().replace('js_doc', 'jsdoc')


def functions(lines, head):
    out = collections.OrderedDict()
    cur = None
    for l in lines:
        m = re.match(head, l)
        if m:
            cur = m.group(1)
            out[cur] = []
        elif cur:
            out[cur].append(l)
    return out


def code(lines):
    text = '\n'.join(x for x in lines if not x.strip().startswith('//'))
    text = re.sub(r'/\*.*?\*/', '', text)
    return re.sub(r'//[^\n"]*$', '', text, flags=re.M)


go = functions(open(GO).read().split('\n'), r'^func (?:\(r \*EmitResolver\) )?(\w+)\(')
# The functions of the resolver end where the hook of the reference resolver and GetConstantValue of services.go begin.
rs_lines = open(RS).read().split('\n')
tail = [i for i, l in enumerate(rs_lines) if l.startswith('// tryGetElementAccessExpressionName as the hook')]
rs = functions(rs_lines[:tail[0]] if tail else rs_lines, r'^(?:    )?pub fn (\w+)[<(]')
names = {g: snake(g) + '_exported' for g in EXPORTED}
for g, body in go.items():
    r = names.get(g, snake(g))
    if r not in rs:
        print('%-55s no function of this name in the file' % r)
        continue
    gtext, rtext = code(body), re.sub(r'\(\s+', '(', code(rs[r]))
    rtext = re.sub(r'\n\s*\.', '.', rtext)
    # methods of the checker
    gm = collections.Counter(snake(x) for x in re.findall(r'\b(?:r\.checker|c)\.(\w+)\(', gtext))
    rm = collections.Counter(re.findall(r'\bc\.(\w+)\(', rtext))
    for h in HELPERS:
        rm.pop(h, None)
    # methods of the resolver
    gr = collections.Counter(snake(x) for x in re.findall(r'\br\.(\w+)\(', gtext))
    rr = collections.Counter(re.findall(r'\bself\.(\w+)\(', rtext))
    # free functions
    gf = collections.Counter(snake(x) for x in re.findall(r'\b(?:ast|core|binder|evaluator)\.(\w+)\(', gtext))
    gf += collections.Counter(snake(x) for x in re.findall(
        r'(?<![\w.])((?:is|get|contains|pseudo|noop)[A-Z]\w*)\(', gtext))
    gf += collections.Counter(snake(x) for x in re.findall(r'ast\.(Is\w+)\)', gtext))
    rf = collections.Counter(x for x in re.findall(r'(?<![\w.:])([a-z_0-9]+)\((?:a|c)\b', rtext)
                             if x not in ('every', 'some', 'new_node_factory'))
    rf += collections.Counter(re.findall(
        r'(?<![\w.:])(get_node_id|noop_add_visible_alias|pseudo_big_int_to_string|every|some|new_reference_resolver)\(',
        rtext))
    rf += collections.Counter('new_result' for _ in re.findall(r'evaluator::new_result\(', rtext))
    diff = {}
    for gc, rc in ((gm, rm), (gr, rr), (gf, rf)):
        for k in set(gc) | set(rc):
            if gc.get(k, 0) != rc.get(k, 0):
                diff[k] = (gc.get(k, 0), rc.get(k, 0))
    print('%-52s checker %2d/%2d  resolver %2d/%2d  free %2d/%2d  %s' % (
        r, sum(gm.values()), sum(rm.values()), sum(gr.values()), sum(rr.values()), sum(gf.values()),
        sum(rf.values()), diff if diff else 'same'))
extra = [r for r in rs if r not in [names.get(g, snake(g)) for g in go]]
print('functions of the file that upstream does not have in emitresolver.go:', extra)
