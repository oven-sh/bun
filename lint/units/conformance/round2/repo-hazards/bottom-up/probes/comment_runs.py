#!/usr/bin/env python3
"""Counts, in the synced corpus of a checkout, what the two comment checks would flag if they read it:
the line test of .github/workflows/comment-cop.yml (isCommentLine, MIN_LINES 2, SAFETY: exempt, SRC_EXT) on every
file as a wholly added file, and the markers TODO, FIXME, XXX, HACK in every file.
usage: comment_runs.py <checkout>"""
import os, re, sys
root = os.path.join(sys.argv[1], 'test/cli/lint/conformance')
SRC = re.compile(r'\.(rs|c|cc|cpp|h|hpp|m|mm|ts|tsx|mts|cts|js|jsx|mjs|cjs)$')
MARK = re.compile(r'TODO|FIXME|XXX|HACK')
PRNUM = re.compile(r'#\d{3,}')
def is_comment(line):
    t = line.lstrip()
    return t.startswith('//') or t.startswith('/*') or t in ('*', '*/') or t.startswith('* ')
def runs(text):
    n = 0; run = []
    def flush():
        nonlocal n, run
        if len(run) >= 2 and not any('SAFETY:' in t for t in run): n += 1
        run = []
    for line in text.split('\n'):
        if is_comment(line): run.append(line)
        else: flush()
    flush()
    return n
groups = {}
for d, _, files in os.walk(root):
    for f in files:
        p = os.path.join(d, f)
        rel = os.path.relpath(p, root)
        seg = rel.split(os.sep)
        if seg[0] != 'corpus': key = 'outside corpus/ (runner, fixtures, scripts)'
        elif seg[1] in ('cases', 'baselines'): key = '/'.join(seg[:3])
        else: key = '/'.join(seg[:2]) if len(seg) > 2 else 'corpus (lists)'
        g = groups.setdefault(key, dict(files=0, src=0, with_run=0, runs=0, with_mark=0, marks={}, with_pr=0))
        text = open(p, 'rb').read().decode('utf-8', errors='replace')
        g['files'] += 1
        if SRC.search(f):
            g['src'] += 1
            r = runs(text)
            if r: g['with_run'] += 1; g['runs'] += r
        else:
            r = runs(text)
            if r: g.setdefault('nonsrc_with_run', 0); g['nonsrc_with_run'] += 1
        m = MARK.findall(text)
        if m:
            g['with_mark'] += 1
            for x in m: g['marks'][x] = g['marks'].get(x, 0) + 1
        if PRNUM.search(text): g['with_pr'] += 1
for k in sorted(groups):
    g = groups[k]
    print(f"{k}: files {g['files']}, with a source ending {g['src']}, of those with a run of 2+ comment lines {g['with_run']} ({g['runs']} runs), "
          f"other files with such a run {g.get('nonsrc_with_run', 0)}, files with a marker {g['with_mark']} {g['marks']}, files with # and 3+ digits {g['with_pr']}")
