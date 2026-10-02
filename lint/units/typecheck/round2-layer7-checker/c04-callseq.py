#!/usr/bin/env python3
# For each function of checker.go 1505-2200 and its translation in checker/c04_name_resolution_hooks.rs: the calls of
# methods of the checker (`c.name(` upstream, `self.name(` or `c.name(` here), by name and number. A line is "same"
# when both sides agree; else it lists the names that differ with the two counts (upstream, here). It compares names
# and counts, not arguments and not order. The layout is the one of c52-callseq.py. usage: c04-callseq.py
import collections
import re

GO = '/workspace/ref/typescript-go/internal/checker/checker.go'
RS = '/workspace/wt/typecheck/src/typecheck/checker/c04_name_resolution_hooks.rs'
# Helpers of the port that stand for a Go operation and not for a call of upstream: a panic, an assert, a cast, the budget of a loop, the stack test, and NewDiagnosticForNode, which is a free function upstream.
HELPERS = ['fail', 'assert', 'stack_limit', 'loop_limit', 'as_interface_type', 'new_diagnostic_for_node',
           'create_diagnostic_for_node']


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


go = functions(open(GO).read().split('\n')[1504:2200], r'^func (?:\(c \*Checker\) )?(\w+)\(')
rs = functions(open(RS).read().split('\n'), r'^(?:    )?pub fn (\w+)[<(]')
for g, body in go.items():
    r = snake(g)
    if r not in rs:
        print('%-62s no function of this name in the file' % r)
        continue
    gtext, rtext = code(body), re.sub(r'\(\s+', '(', code(rs[r]))
    gm = collections.Counter(snake(x) for x in re.findall(r'\bc\.(\w+)\(', gtext))
    rm = collections.Counter(re.findall(r'\b(?:self|c)\.(\w+)\(', rtext))
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
