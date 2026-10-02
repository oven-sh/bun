#!/usr/bin/env python3
# For each function of checker.go 20115-20727 and its translation in checker/c34_return_types.rs: the calls of methods
# of the checker (`c.name(` upstream, `self.name(` or `c.name(` here), by name and number. A line is "same" when both
# sides agree; else it lists the names that differ with the two counts (upstream, here). It compares names and counts,
# not arguments and not order. A call may begin on the line after `self`. The methods of an iteration types resolver
# (`resolver.name(` on both sides) are not calls of the checker and are not counted. After the functions it prints:
# the functions of the file outside the range, whether the order of the range is kept, the imported names that the
# file does not use, the comment lines that touch another comment line, the forbidden words, and the messages that are
# no constant of the generated table. The layout is the one of c16-callseq.py. usage: c34-callseq.py
import collections
import re

GO = '/workspace/ref/typescript-go/internal/checker/checker.go'
RS = '/workspace/wt/typecheck/src/typecheck/checker/c34_return_types.rs'
MESSAGES = '/workspace/wt/typecheck/src/typecheck/diagnostics/diagnostics_generated.rs'
# Helpers of the port that stand for a Go operation and not for a call of upstream: the stack test, a slice that is kept (list_of), t.Types() (type_types).
HELPERS = ['stack_limit', 'list_of', 'type_types']
# Upstream's exported name and the name of the port.
RENAMED = {'type_to_string': 'type_to_string_exported'}


def snake(name):
    s = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1_\2', name)
    s = re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', s)
    s = s.lower().replace('js_doc', 'jsdoc').replace('es_2015', 'es2015')
    return RENAMED.get(s, s)


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


source = open(RS).read()
go = functions(open(GO).read().split('\n')[20114:20727], r'^func (?:\(c \*Checker\) )?(\w+)\(')
rs = functions(source.split('\n'), r'^(?:    )?pub fn (\w+)[<(]')
for g, body in go.items():
    r = snake(g)
    if r not in rs:
        print('%-72s no function of this name in the file' % r)
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
    print('%-72s methods %2d/%2d  %s' % (r, sum(gm.values()), sum(rm.values()), diff if diff else 'same'))
extra = [r for r in rs if r not in [snake(g) for g in go]]
print('functions of the file outside the range:', extra)
print('order of the range kept:', [snake(g) for g in go] == [r for r in rs if r not in extra])

lines = source.split('\n')
end = next(i for i, l in enumerate(lines) if l.startswith('impl') or l.startswith('pub fn'))
head, body = '\n'.join(lines[:end]), '\n'.join(l for l in lines[end:] if not l.strip().startswith('//'))
imported = []
for m in re.finditer(r'^use ([\w:]+)(?:::\{([^}]*)\})?;', head, re.M):
    names = m.group(2).split(',') if m.group(2) else [m.group(1).split('::')[-1]]
    imported += [n.strip() for n in names if n.strip()]
print('imported names:', len(imported), ' not used:', [n for n in imported if not re.search(r'\b' + re.escape(n) + r'\b', body)])
adjacent = [i + 1 for i in range(1, len(lines)) if lines[i].strip().startswith('//') and lines[i - 1].strip().startswith('//')]
print('comment lines that follow a comment line:', adjacent)
words = ['unwrap(', 'expect(', 'panic!', 'todo!', 'unimplemented!', 'unreachable!', 'unsafe', 'allow(']
print('forbidden words:', [(w, i + 1) for i, l in enumerate(lines) for w in words if w in l and not l.strip().startswith('//')])
table = open(MESSAGES).read()
used = sorted(set(re.findall(r'diagnostics::([A-Z0-9_]+)', body)))
print('messages:', len(used), ' not in the table:', [u for u in used if not re.search(r'^\s*\(' + u + r',', table, re.M)])
