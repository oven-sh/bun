#!/usr/bin/env python3
# Compares functions of two assembly files of the crate: the instruction streams with local labels masked.
# usage: fncmp.py <a.s> <b.s> [--show <substring of a demangled name>]
import re, subprocess, sys, difflib
def load(path):
    fns, cur, name = {}, None, None
    for line in open(path, errors='replace'):
        m = re.match(r'\s*\.type\s+(\S+),@function', line)
        if m: name = m.group(1); cur = []; continue
        if cur is None: continue
        s = line.strip()
        if s.startswith('.size') or s.startswith('.Lfunc_end'):
            fns[name] = cur; cur = None; continue
        if not s or s.startswith('.') or s.startswith('#') or s.endswith(':'): continue
        s = re.sub(r'\.L[\w.$]+', '.L', s)
        s = re.sub(r'\s+#.*$', '', s)
        cur.append(s)
    return fns
def demangle(names):
    out = subprocess.run(['/usr/lib/llvm-current/bin/llvm-cxxfilt'], input='\n'.join(names), capture_output=True, text=True).stdout.split('\n')
    return dict(zip(names, out))
a, b = load(sys.argv[1]), load(sys.argv[2])
show = sys.argv[4] if len(sys.argv) > 4 and sys.argv[3] == '--show' else None
names = sorted(set(a) | set(b)); dm = demangle(names)
def jcc(body): return sum(1 for s in body if re.match(r'j(?!mp)[a-z]+\b', s))
same = diff = 0; rows = []
for n in names:
    x, y = a.get(n), b.get(n)
    if x is None: rows.append(('ONLY-B', 0, len(y), 0, jcc(y), dm[n])); continue
    if y is None: rows.append(('ONLY-A', len(x), 0, jcc(x), 0, dm[n])); continue
    if x == y: same += 1; continue
    diff += 1
    sm = difflib.SequenceMatcher(None, x, y, autojunk=False)
    changed = sum(max(i2 - i1, j2 - j1) for tag, i1, i2, j1, j2 in sm.get_opcodes() if tag != 'equal')
    rows.append(('DIFF', len(x), len(y), jcc(x), jcc(y), dm[n] + '   [%d instructions in changed runs]' % changed))
    if show and show in dm[n]:
        for tag, i1, i2, j1, j2 in sm.get_opcodes():
            if tag == 'equal': continue
            print('   @a%d..%d b%d..%d %s' % (i1, i2, j1, j2, tag))
            for s in x[i1:i2][:40]: print('     - ' + s)
            for s in y[j1:j2][:40]: print('     + ' + s)
print('identical', same, 'differ', diff, 'only', len(rows) - diff)
for r in rows: print('%-7s insns %5d %5d  jcc %4d %4d  %s' % r)
