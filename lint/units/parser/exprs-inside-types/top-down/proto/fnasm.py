#!/usr/bin/env python3
"""usage: fnasm.py <file.s> <regex>   prints the demangled, label-normalized body of the first matching function of P<true, false>"""
import re, subprocess, sys
text = subprocess.run(['llvm-cxxfilt'], stdin=open(sys.argv[1]), capture_output=True, text=True, errors='replace').stdout
rx = re.compile(sys.argv[2]); cur = None; body = []
for line in text.splitlines():
    m = re.match(r'^\t\.type\t(.*),@function$', line)
    if m:
        cur = m.group(1) if rx.search(m.group(1)) and 'P<true, true>' not in m.group(1) else None; body = []; continue
    if cur is None: continue
    if line.startswith('\t.size\t') or line.startswith('\t.cfi_endproc'):
        print('### ' + cur); print('\n'.join(body)); break
    s = line.strip()
    if not s or s.startswith(('.cfi', '.loc', '.file', '#', '.p2align', '.section', '.globl', '.hidden', '.weak', '.type')): continue
    body.append(s)
