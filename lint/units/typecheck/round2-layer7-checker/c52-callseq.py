#!/usr/bin/env python3
# For each function of checker.go 31704-32296 and its translation in checker/c52_symbol_at_location.rs: the calls of
# methods of the checker (`c.name(` upstream, `self.name(` or `c.name(` here) and the calls of free functions (`ast.Name(`,
# `core.Name(` and the free functions of the package upstream, `name(a, ...)` here), by name and number. A line is
# "same" when both sides agree; else it lists the names that differ with the two counts (upstream, here).
# It compares names and counts, not arguments and not order. usage: c52-callseq.py
import collections
import re

GO = '/workspace/ref/typescript-go/internal/checker/checker.go'
RS = '/workspace/wt/typecheck/src/typecheck/checker/c52_symbol_at_location.rs'
# Helpers of the port that stand for a Go operation and not for a call of upstream.
HELPERS = ['fail', 'stack_limit', 'map_set', 'list_of', 'filter', 'type_distributed', 'value_symbol_links_get',
           'as_object_type', 'as_interface_type', 'as_type_reference', 'as_intersection_type']


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
    return re.sub(r'/\*.*?\*/', '', text)


go = functions(open(GO).read().split('\n')[31703:32296], r'^func \(c \*Checker\) (\w+)\(')
rs = functions(open(RS).read().split('\n'), r'^    pub fn (\w+)[<(]')
names = {'GetSymbolAtLocation': 'get_symbol_at_location_exported'}
for g, body in go.items():
    r = names.get(g, snake(g))
    if r not in rs:
        print('%-55s no function of this name in the file' % r)
        continue
    gtext, rtext = code(body), re.sub(r'\(\s+', '(', code(rs[r]))
    gm = collections.Counter(snake(x) for x in re.findall(r'\bc\.(\w+)\(', gtext))
    rm = collections.Counter(re.findall(r'\b(?:self|c)\.(\w+)\(', rtext))
    for h in HELPERS:
        rm.pop(h, None)
    gf = collections.Counter(snake(x) for x in re.findall(r'\b(?:ast|core)\.(\w+)\(', gtext))
    gf += collections.Counter(snake(x) for x in re.findall(r'(?<![\w.])((?:is|get|node|new)[A-Z]\w*|IsTypeAny)\(', gtext))
    gf += collections.Counter(snake(x) for x in re.findall(r'ast\.(Is\w+)\)', gtext))
    rf = collections.Counter(re.findall(r'(?<![\w.:])([a-z_0-9]+)\(a\b', rtext))
    rf += collections.Counter(re.findall(r'(?<![\w.:])(is_type_any|first_or_nil|append_if_unique|get_reparsed_node_for_node)\(', rtext))
    diff = {}
    for gc, rc in ((gm, rm), (gf, rf)):
        for k in set(gc) | set(rc):
            if gc.get(k, 0) != rc.get(k, 0):
                diff[k] = (gc.get(k, 0), rc.get(k, 0))
    print('%-55s methods %2d/%2d  free %2d/%2d  %s' % (r, sum(gm.values()), sum(rm.values()), sum(gf.values()),
                                                       sum(rf.values()), diff if diff else 'same'))
extra = [r for r in rs if r not in [names.get(g, snake(g)) for g in go]]
print('functions of the file outside the range:', extra)
