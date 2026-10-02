#!/usr/bin/env python3
# Counts the arguments of the calls of a file of src/typecheck/checker against the definitions of the tree. A call is
# `self.name(`, `a.name(`, `c.name(`, `resolver.name(` or a bare `name(`; a call on another receiver (`x.is_nil()`,
# `List::from_slice(`) is not looked at. A call is accepted when some `fn` of that name under src/typecheck takes as
# many arguments and is a method where the call has a receiver: the script does not know which definition the call
# means, and it compares no types. It prints the calls without such a definition and the two totals.
# usage: c34-arity.py [file]   (default: checker/c34_return_types.rs)
import os
import re
import sys

ROOT = '/workspace/wt/typecheck/src/typecheck'
RS = sys.argv[1] if len(sys.argv) > 1 else ROOT + '/checker/c34_return_types.rs'
WORDS = ('if', 'match', 'while', 'for', 'return', 'fn', 'let', 'Some', 'Ok', 'Err')


def strip_comments(text):
    return '\n'.join(l for l in text.split('\n') if not l.strip().startswith('//'))


def split_args(s, generics=False):
    # The arguments of a call, or with `generics` the parameters of a definition, whose `<...>` hold commas.
    args, depth, cur, pipe, prev = [], 0, '', False, ''
    s = s.replace('||', '\x00\x00')
    for ch in s:
        if ch in '([{' or (generics and ch == '<'):
            depth += 1
        elif ch in ')]}' or (generics and ch == '>' and prev != '-'):
            depth -= 1
        elif ch == '|' and not generics:
            pipe = not pipe
        prev = ch
        if ch == ',' and depth == 0 and not pipe:
            args.append(cur)
            cur = ''
        else:
            cur += ch
    if cur.strip():
        args.append(cur)
    return [a.strip() for a in args if a.strip()]


def inside_parens(text, start):
    depth = 0
    for i in range(start, len(text)):
        if text[i] == '(':
            depth += 1
        elif text[i] == ')':
            depth -= 1
            if depth == 0:
                return text[start + 1:i]
    return None


defs = {}
for d, _, files in os.walk(ROOT):
    for f in files:
        if not f.endswith('.rs'):
            continue
        p = os.path.join(d, f)
        text = strip_comments(open(p, errors='replace').read())
        for m in re.finditer(r'\bfn\s+([a-z_][a-z0-9_]*)\s*(?:<[^(]*>)?\s*\(', text):
            inside = inside_parens(text, m.end() - 1)
            if inside is None:
                continue
            params = split_args(inside, True)
            has_self = bool(params) and re.match(r'^(&\s*(mut\s+)?)?(mut\s+)?self\b', params[0]) is not None
            defs.setdefault(m.group(1), []).append((len(params) - (1 if has_self else 0), has_self, os.path.relpath(p, ROOT)))

text = strip_comments(open(RS).read())
bad = seen = 0
for m in re.finditer(r'(\bself\s*\.\s*|\ba\s*\.\s*|\bresolver\s*\.\s*|\bc\s*\.\s*|(?<![\w.:]))([a-z_][a-z0-9_]*)\s*\(', text):
    recv, name = m.group(1).strip(), m.group(2)
    if name in WORDS or re.search(r'fn\s*$', text[max(0, m.start() - 12):m.start()]):
        continue
    inside = inside_parens(text, m.end() - 1)
    if inside is None:
        continue
    n = len(split_args(inside))
    cands = defs.get(name)
    if not cands:
        print('no definition:', recv, name, n)
        bad += 1
        continue
    seen += 1
    if not [c for c in cands if c[0] == n and c[1] == (recv != '')]:
        print('arguments differ:', recv, name, 'called with', n, 'definitions:', sorted(set(cands))[:6])
        bad += 1
print('calls checked:', seen, ' problems:', bad)
