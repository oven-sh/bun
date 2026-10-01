#!/usr/bin/env python3
"""usage: comments.py <directory of the corpus on disk>
Counts, with the rule of tools/commentcop.py (and of comment-cop.yml), the files of the corpus that hold a run of two
or more comment lines, and the files that hold a marker. Reads only."""
import os, re, sys
root = sys.argv[1]
SRC = re.compile(r'\.(rs|c|cc|cpp|h|hpp|m|mm|ts|tsx|mts|cts|js|jsx|mjs|cjs)$')
MARK = re.compile(r'\b(TODO|FIXME|XXX|HACK)\b')
PR = re.compile(r'#\d{3,}')
def is_comment(line):
    t = line.lstrip()
    return t.startswith('//') or t.startswith('/*') or t in ('*', '*/') or t.startswith('* ')
kinds = {}
for d, _, files in os.walk(root):
    for f in files:
        p = os.path.join(d, f)
        rel = os.path.relpath(p, root)
        top = rel.split(os.sep)
        kind = '/'.join(top[:2]) if top[0] in ('cases', 'baselines') and len(top) > 2 else top[0]
        k = kinds.setdefault(kind, dict(files=0, src=0, run=0, run_directives_only=0, mark=0, marks={}, pr=0))
        k['files'] += 1
        text = open(p, 'rb').read().decode('utf-8', errors='replace')
        lines = text.split('\n')
        if SRC.search(f):
            k['src'] += 1
            run = []; has = False; only_directives = True
            def flush():
                global has, only_directives
                if len(run) >= 2 and not any('SAFETY:' in t for t in run):
                    has = True
                    if not all(re.match(r'\s*//\s*@\w+\s*:', t.lstrip('\ufeff')) for t in run): only_directives = False
            for l in lines:
                if is_comment(l.rstrip('\r')): run.append(l)
                else:
                    flush(); run = []
            flush()
            if has:
                k['run'] += 1
                if only_directives: k['run_directives_only'] += 1
        found = MARK.findall(text)
        if found:
            k['mark'] += 1
            for m in found: k['marks'][m] = k['marks'].get(m, 0) + 1
        if PR.search(text): k['pr'] += 1
for kind in sorted(kinds):
    k = kinds[kind]
    print(f"{kind}: {k['files']} files, {k['src']} with a source ending; a run of comment lines in {k['run']} "
          f"({k['run_directives_only']} where every run is directives only); a marker in {k['mark']} {k['marks']}; '#' and three digits in {k['pr']}")
