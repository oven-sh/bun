#!/usr/bin/env python3
"""Token-level 3-way merge of the diff3 conflict hunks that git left in the files of /tmp/h/conflicted.txt.
usage: tokmerge.py report|apply [path-substring...]
report: prints every hunk and what the token merge gives. apply: rewrites the hunks that merge cleanly."""
import re, sys
from difflib import SequenceMatcher

TOK = re.compile(r'\n[ \t]*|[ \t]+|[A-Za-z_0-9]+|.', re.S)

def toks(s):
    return TOK.findall(s)

def sync_regions(base, a, b):
    am = SequenceMatcher(None, base, a, autojunk=False).get_matching_blocks()
    bm = SequenceMatcher(None, base, b, autojunk=False).get_matching_blocks()
    ia = ib = 0
    sl = []
    while ia < len(am) and ib < len(bm):
        abase, amatch, alen = am[ia]
        bbase, bmatch, blen = bm[ib]
        lo = max(abase, bbase); hi = min(abase + alen, bbase + blen)
        if lo < hi:
            sl.append((lo, hi, amatch + (lo - abase), amatch + (hi - abase), bmatch + (lo - bbase), bmatch + (hi - bbase)))
        if abase + alen < bbase + blen:
            ia += 1
        else:
            ib += 1
    sl.append((len(base), len(base), len(a), len(a), len(b), len(b)))
    return sl

def merge3(base, a, b):
    """returns (tokens, conflicts) where conflicts is a list of (base, a, b) chunks that both sides changed"""
    out = []
    conflicts = []
    iz = ia = ib = 0
    for zs, ze, as_, ae, bs, be in sync_regions(base, a, b):
        zc = base[iz:zs]; ac = a[ia:as_]; bc = b[ib:bs]
        if zc or ac or bc:
            if ac == bc:
                out.extend(ac)
            elif ac == zc:
                out.extend(bc)
            elif bc == zc:
                out.extend(ac)
            else:
                conflicts.append((''.join(zc), ''.join(ac), ''.join(bc)))
                out.append('\0CONFLICT%d\0' % (len(conflicts) - 1))
        out.extend(base[zs:ze])
        iz, ia, ib = ze, ae, be
    return out, conflicts

def hunks_of(lines):
    i = 0
    while i < len(lines):
        if lines[i].startswith('<<<<<<< '):
            o = i
            while not lines[i].startswith('||||||| '): i += 1
            m1 = i
            while lines[i] != '=======': i += 1
            m2 = i
            while not lines[i].startswith('>>>>>>> '): i += 1
            yield (o, m1, m2, i)
        i += 1

def main():
    mode = sys.argv[1]
    only = sys.argv[2:]
    files = [l.strip() for l in open('/tmp/h/conflicted.txt') if l.strip()]
    total = clean = 0
    for f in files:
        if only and not any(o in f for o in only): continue
        lines = open(f, encoding='utf8').read().split('\n')
        new = []
        last = 0
        for (o, m1, m2, e) in hunks_of(lines):
            total += 1
            ours = '\n'.join(lines[o+1:m1]); base = '\n'.join(lines[m1+1:m2]); theirs = '\n'.join(lines[m2+1:e])
            # a leading newline token makes the first line tokenize like every other line
            merged, conflicts = merge3(toks('\n' + base), toks('\n' + ours), toks('\n' + theirs))
            text = ''.join(merged)
            ok = not conflicts
            if mode == 'report':
                print(f'=== HUNK {total} {f}:{o+1} {"CLEAN" if ok else "CONFLICT x%d" % len(conflicts)} ===')
                print('--- base');   print(base)
                print('--- ours');   print(ours)
                print('--- theirs'); print(theirs)
                if ok:
                    print('--- merged'); print(text[1:])
                else:
                    for k, (zc, ac, bc) in enumerate(conflicts):
                        print(f'--- conflict {k}: base={zc!r}\n      ours={ac!r}\n      theirs={bc!r}')
                print()
            if ok:
                clean += 1
                new.extend(lines[last:o])
                body = text[1:]
                if body != '' or (m1 - o - 1) or (e - m2 - 1):
                    new.extend(body.split('\n') if (body != '' or ours != '' and theirs != '') else [])
                last = e + 1
        new.extend(lines[last:])
        if mode == 'apply':
            open(f, 'w', encoding='utf8').write('\n'.join(new))
    print(f'hunks {total} clean {clean}', file=sys.stderr)

main()
