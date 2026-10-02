#!/usr/bin/env python3
"""Which unresolved names of a link of a copy of the parser are expected, and which make the comparison void.
usage: stale.py <unresolved.txt> <tree that was linked> [<head tree>] [--lint REGEX]
<unresolved.txt>: one demangled name per line (lld: `undefined symbol: <name>`), as cycle2.sh writes it.
expected: a name of bun_js_parser that holds a function which the head tree defines and the linked tree does not (the
          reference lacks the code of the lint parse; the crates of the release build call it), or a name that matches --lint.
STALE:    every other name. A function that the linked tree defines and the link does not find was mangled with another
          number of its impl block (v0 mangling counts the impl blocks of a module); a name outside bun_js_parser is a
          generic instantiation that the other crates take from the parser crate (-Zshare-generics). ThinLTO then drops
          what only that name reaches and the binary cannot be compared: add the shim (mkref.sh) or run the release build.
Prints the STALE names and exits 1 when there is one."""
import os, re, sys
def arg(k, d): return sys.argv[sys.argv.index(k) + 1] if k in sys.argv else d
pos = [a for a in sys.argv[1:] if not a.startswith('--') and a != arg('--lint', None)]
names = [l.strip() for l in open(pos[0]) if l.strip()]
tree = pos[1]; head = pos[2] if len(pos) > 2 else '/workspace/wt/parser'
LINT = re.compile(arg('--lint', r'$^'))
def fns(t):
    out = set()
    for d, _, fs in os.walk(os.path.join(t, 'src/js_parser')):
        for f in fs:
            if f.endswith('.rs'): out |= set(re.findall(r'\bfn (\w+)', open(os.path.join(d, f), errors='replace').read()))
    return out
only = fns(head) - fns(tree)
rx = re.compile(r'::(?:' + '|'.join(sorted(only)) + r')(?![A-Za-z0-9_])') if only else None
stale = [n for n in names if not (LINT.search(n) or ('bun_js_parser' in n and rx and rx.search(n)))]
for n in stale: print(n)
sys.stderr.write('%d unresolved names, %d expected, %d STALE\n' % (len(names), len(names) - len(stale), len(stale)))
sys.exit(1 if stale else 0)
