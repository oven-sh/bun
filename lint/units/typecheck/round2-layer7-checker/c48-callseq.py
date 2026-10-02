#!/usr/bin/env python3
# For each function of checker.go 29449-30162 and its translation in checker/c48_contextual_types.rs: the calls of
# methods of the checker (`c.name(` upstream, `self.name(` or `c.name(` here), by name and number. A line is "same"
# when both sides agree; else it lists the names that differ with the two counts (upstream, here). It compares names
# and counts, not arguments and not order. A call may begin on the line after `self`. The layout is the one of
# c16-callseq.py. usage: c48-callseq.py
import collections
import re

GO = '/workspace/ref/typescript-go/internal/checker/checker.go'
RS = '/workspace/wt/typecheck/src/typecheck/checker/c48_contextual_types.rs'
# Helpers of the port that stand for a Go operation and not for a call of upstream: the stack test, a panic (fail), a slice that is kept (list, list_of), t.TargetTupleType() (type_target_tuple_type) and valueSymbolLinks.Get (value_symbol_links_get).
HELPERS = ['stack_limit', 'fail', 'list', 'list_of', 'type_target_tuple_type', 'value_symbol_links_get']


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
    return re.sub(r'/\*.*?\*/', '', text, flags=re.S)


go = functions(open(GO).read().split('\n')[29448:30162], r'^func (?:\(c \*Checker\) )?(\w+)\(')
rs = functions(open(RS).read().split('\n'), r'^(?:    )?pub fn (\w+)[<(]')
for g, body in go.items():
    r = snake(g)
    if r not in rs:
        print('%-62s no function of this name in the file' % r)
        continue
    gtext, rtext = code(body), re.sub(r'\(\s+', '(', code(rs[r]))
    # A method of upstream passed as a value (c.name without a call) is a call inside a closure here.
    gm = collections.Counter(snake(x) for x in re.findall(r'\bc\.(\w+)\(', gtext))
    gv = collections.Counter(snake(x) for x in re.findall(r'\bc\.(get\w+|is\w+)\)', gtext))
    gm.update(gv)
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
