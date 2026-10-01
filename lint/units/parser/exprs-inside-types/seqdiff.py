#!/usr/bin/env python3
"""Diffs one function of two run.py outputs with every label replaced by one name, so that only added, removed or changed instructions show.
usage: seqdiff.py <a.s> <b.s> <regex of the demangled name>"""
import re, subprocess, sys, difflib
def load(path, rx):
    text = subprocess.run(['python3', '/tmp/eit/fnasm.py', path, rx], capture_output=True, text=True).stdout
    out = []
    for l in text.splitlines()[2:]:
        s = l.strip()
        if re.match(r'^\.L\d+:$', s): continue
        out.append(re.sub(r'\.L\d+', '.L', s))
    return out
a = load(sys.argv[1], sys.argv[3]); b = load(sys.argv[2], sys.argv[3])
sm = difflib.SequenceMatcher(None, a, b, autojunk=False)
same = sum(m.size for m in sm.get_matching_blocks())
print('instructions a %d b %d, common in order %d' % (len(a), len(b), same))
for tag, i1, i2, j1, j2 in sm.get_opcodes():
    if tag == 'equal': continue
    print('--- %s a[%d:%d] b[%d:%d]' % (tag, i1, i2, j1, j2))
    for l in a[i1:i2][:14]: print('   - ' + l)
    for l in b[j1:j2][:14]: print('   + ' + l)
