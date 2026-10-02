#!/usr/bin/env python3
# For every `pub fn` of checker/c18_identifiers_property_access_this.rs: the calls that the other files of checker/,
# evaluator/ and modulespecifiers/ make into it, with the number of arguments of each call beside the number that the
# definition takes. It compares names and counts, not types: the probe (c18-probe.sh) compiles the shapes of the calls.
# usage: python3 c18-callsites.py      exit 1 when a call gives another number of arguments than its definition takes
import os
import re
import sys

ROOT = '/workspace/wt/typecheck/src/typecheck'
ME = 'checker/c18_identifiers_property_access_this.rs'

src = open(os.path.join(ROOT, ME)).read()
defs = {}
for m in re.finditer(r'^(?:    )?pub fn (\w+)\s*(?:<[^>]*>)?\(([^{]*?)\)\s*(?:->[^{]*)?\{', src, re.M | re.S):
    params = [p.strip() for p in re.split(r',(?![^<(]*[>)])', m.group(2)) if p.strip()]
    method = bool(params) and params[0] in ('&self', '&mut self', 'self')
    defs[m.group(1)] = (len(params) - (1 if method else 0), method)


def count_args(text, start):
    # text[start] is the `(` of a call: the commas at its own depth.
    depth, args, seen, i = 0, 0, False, start
    while i < len(text):
        ch = text[i]
        if ch in '([{':
            depth += 1
            if depth > 1:
                seen = True
        elif ch in ')]}':
            depth -= 1
            if depth == 0:
                return args + (1 if seen else 0)
        elif ch == ',' and depth == 1:
            args += 1
            seen = False
        elif not ch.isspace():
            seen = True
        i += 1
    return -1


total = bad = 0
files = set()
for d, _, fs in sorted(os.walk(ROOT)):
    for f in sorted(fs):
        rel = os.path.relpath(os.path.join(d, f), ROOT)
        if not f.endswith('.rs') or rel == ME:
            continue
        if not rel.startswith(('checker/', 'evaluator/', 'modulespecifiers/')):
            continue
        text = open(os.path.join(ROOT, rel)).read()
        for name, (n, method) in sorted(defs.items()):
            pat = re.compile((r'\.\s*' if method else r'(?<![\w.])') + re.escape(name) + r'\(')
            for m in pat.finditer(text):
                if 'fn ' in text[max(0, m.start() - 8):m.start()]:
                    continue
                got = count_args(text, m.end() - 1)
                total += 1
                files.add(rel)
                note = '' if got == n else '   MISMATCH: the definition takes %d' % n
                bad += got != n
                print('%s:%d %s(%d)%s' % (rel, text.count('\n', 0, m.start()) + 1, name, got, note))
print('%d definitions, %d call sites in %d files, %d mismatches' % (len(defs), total, len(files), bad))
sys.exit(1 if bad else 0)
