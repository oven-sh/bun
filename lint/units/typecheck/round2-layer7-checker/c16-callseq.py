#!/usr/bin/env python3
# For each function of checker.go 10133-10705 and its translation in checker/c16_function_expressions_collisions.rs: the calls of
# methods of the checker (`c.name(` upstream, `self.name(` or `c.name(` here), by name and number. A line is "same"
# when both sides agree; else it lists the names that differ with the two counts (upstream, here). It compares names
# and counts, not arguments and not order. A call may begin on the line after `self`. checkClassExpressionExternalHelpers
# (10171) is in c46_mark_references.rs, so the script says that the file has no function of its name and that the order of
# the range is not kept. The layout is the one of c04-callseq.py. usage: c16-callseq.py
import collections
import re

GO = '/workspace/ref/typescript-go/internal/checker/checker.go'
RS = '/workspace/wt/typecheck/src/typecheck/checker/c16_function_expressions_collisions.rs'
# Helpers of the port that stand for a Go operation and not for a call of upstream: the stack test, a slice that is kept (list_of), a map write (map_set), t.Types() (type_types) and valueSymbolLinks.Get (value_symbol_links_get).
HELPERS = ['stack_limit', 'list_of', 'map_set', 'type_types', 'value_symbol_links_get']


def snake(name):
    s = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1_\2', name)
    s = re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', s)
    return s.lower().replace('js_doc', 'jsdoc').replace('es_2015', 'es2015')


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


go = functions(open(GO).read().split('\n')[10132:10705], r'^func (?:\(c \*Checker\) )?(\w+)\(')
rs = functions(open(RS).read().split('\n'), r'^(?:    )?pub fn (\w+)[<(]')
for g, body in go.items():
    r = snake(g)
    if r not in rs:
        print('%-62s no function of this name in the file' % r)
        continue
    gtext, rtext = code(body), re.sub(r'\(\s+', '(', code(rs[r]))
    gm = collections.Counter(snake(x) for x in re.findall(r'\bc\.(\w+)\(', gtext))
    rm = collections.Counter(re.findall(r'\b(?:self|c)\s*\.(\w+)\(', rtext))
    for h in HELPERS:
        rm.pop(h, None)
    diff = {}
    for k in set(gm) | set(rm):
        if gm.get(k, 0) != rm.get(k, 0):
            diff[k] = (gm.get(k, 0), rm.get(k, 0))
    print('%-62s methods %2d/%2d  %s' % (r, sum(gm.values()), sum(rm.values()), diff if diff else 'same'))
extra = [r for r in rs if r not in [snake(g) for g in go]]
print('functions of the file outside the range:', extra)
print('order of the range kept:', [snake(g) for g in go] == [r for r in rs if r not in extra])
