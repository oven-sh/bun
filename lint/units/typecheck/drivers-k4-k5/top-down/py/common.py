# Research probe: reads the manifest of the reference's suite (one line per run instance, made by ../../bottom-up/groundtruth/k5).
import gzip, json, os
HERE = os.path.dirname(os.path.abspath(__file__))
def rows():
    live = '/tmp/k4drv/k5/out/manifest.jsonl'
    if os.path.exists(live):
        return [json.loads(l) for l in open(live)]
    return [json.loads(l) for l in gzip.open(os.path.join(HERE, '..', 'data', 'manifest.with-opts.jsonl.gz'), 'rt')]
def fmt_by_ext(n, pjt=''):
    if n.endswith(('.d.mts', '.mts', '.mjs')): return 99
    if n.endswith(('.d.cts', '.cts', '.cjs')): return 1
    if n.endswith(('.d.ts', '.ts', '.tsx', '.js', '.jsx')): return 99 if pjt == 'module' else 1
    return 0
POST_EMIT = {'compiler/incorrectRecursiveMappedTypeConstraint.ts', 'compiler/typeParameterWithInvalidConstraintType.ts', 'conformance/recursiveMappedTypes.ts'}
def key(r): return r['suite'] + '/' + r['name']
def cls(r): return 'E' if r['used'] > 0 else 'C'
# A program that needs no recorded input: the non-lib files are the roots in order, nothing resolves, no package.json scope.
def trivial(r):
    files = r['files'] or []
    if [f['n'] for f in files] != (r['roots'] or []): return False
    for f in files:
        if f.get('pjt') or f.get('pjd') or f.get('jsx') or f.get('helpers') or f.get('ext'): return False
        if f['fmt'] != fmt_by_ext(f['n']): return False
        if any(len(x) > 3 and x[2] for x in f.get('res', [])): return False
        if any(t for _, t in f.get('reflist', [])) or f.get('typelist') or f.get('liblist'): return False
    if r.get('autotypes') or r.get('libfiles') or r.get('symlinks') or not r['caseSensitive']: return False
    return True
# What keeps an instance out of reach of a program stand-in that has no emit, no option checks and no JavaScript trees.
def out_of_reach(r):
    why = []
    files = r['files'] or []
    if any(f['sk'] in (1, 2) for f in files): why.append('js-unit')
    if any(f['sk'] == 6 for f in files): why.append('json-unit')
    d = r['diag']
    for k in ('config', 'program', 'include', 'declaration', 'suggestion'):
        if d.get(k): why.append(k + '-diag')
    if key(r) in POST_EMIT: why.append('post-emit-order')
    if not r['caseSensitive']: why.append('case-insensitive')
    if r.get('symlinks'): why.append('symlinks')
    return why
