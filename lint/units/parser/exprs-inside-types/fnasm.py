#!/usr/bin/env python3
"""Prints the assembly of the functions of a run.py output whose demangled name matches a regex (local labels renumbered).
usage: fnasm.py <file.s> <regex>"""
import re, subprocess, sys
path, rx = sys.argv[1], re.compile(sys.argv[2])
text = subprocess.run(['llvm-cxxfilt'], stdin=open(path), capture_output=True, text=True, errors='replace').stdout
cur = None; body = []
for line in text.splitlines():
    m = re.match(r'^\t\.type\t(.*),@function$', line)
    if m:
        cur = m.group(1) if rx.search(m.group(1)) else None; body = []; continue
    if cur is None: continue
    if line.startswith('\t.size\t') or line.startswith('\t.cfi_endproc'):
        labels = {}
        def lab(mm):
            k = mm.group(0)
            if k not in labels: labels[k] = '.L%d' % len(labels)
            return labels[k]
        print('==', cur)
        for l in body: print('   ', re.sub(r'\.L[\w.$]+', lab, l))
        cur = None; continue
    s = line.strip()
    if not s or s.startswith(('.cfi', '.loc', '.file', '#', '.p2align', '.section', '.globl', '.hidden', '.weak', '.type')): continue
    body.append(s)
