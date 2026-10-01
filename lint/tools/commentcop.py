#!/usr/bin/env python3
"""Lists added runs of two or more comment lines in src/ of a diff, as the repository's comment check does.
usage: commentcop.py <base>...<head or empty for worktree> [--list N]"""
import re, subprocess, sys
rng = sys.argv[1]
show = int(sys.argv[sys.argv.index('--list') + 1]) if '--list' in sys.argv else 15
d = subprocess.run(['git', 'diff', '--unified=0', rng, '--', 'src/'], capture_output=True, text=True, errors='replace').stdout
SRC = re.compile(r'\.(rs|c|cc|cpp|h|hpp|m|mm|ts|tsx|mts|cts|js|jsx|mjs|cjs)$')
def is_comment(line):
    t = line.lstrip()
    return t.startswith('//') or t.startswith('/*') or t in ('*', '*/') or t.startswith('* ')
cur = None; run = []; ln = 0; found = []
def flush():
    global run
    if len(run) >= 2 and not any('SAFETY:' in t for _, t in run):
        found.append((cur, run[0][0], len(run), run[0][1].strip()[:90]))
    run = []
for l in d.split('\n'):
    if l.startswith('+++ '):
        flush(); cur = l[6:] if l.startswith('+++ b/') else None; continue
    if l.startswith('@@'):
        flush(); m = re.search(r'\+(\d+)', l); ln = int(m.group(1)) - 1; continue
    if l.startswith('+') and not l.startswith('+++'):
        ln += 1
        if cur and SRC.search(cur) and is_comment(l[1:]): run.append((ln, l[1:]))
        else: flush()
    else: flush()
flush()
by = {}
for f, *_ in found: by[f] = by.get(f, 0) + 1
print(f'added multi-line comment runs: {len(found)} in {len(by)} files')
for f, n in sorted(by.items(), key=lambda kv: -kv[1])[:show]: print(f'  {n:5}  {f}')
if '--all' in sys.argv:
    for f, a, n, t in found: print(f'{f}:{a} ({n} lines) {t}')
