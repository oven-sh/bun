# Research probe: facts about the programs of the 12,797 run instances of the reference's suite (manifest.jsonl of setup3.sh).
import json, collections, sys
rows = [json.loads(l) for l in open('/tmp/k4drv/k5/out/manifest.jsonl')]
n = len(rows)
print('instances', n, 'with an error baseline (used > 0)', sum(1 for r in rows if r['used'] > 0))
# 1. lib sets
libsets = collections.Counter(r['libs'] for r in rows)
print('distinct lib sets', len(libsets))
for s, c in libsets.most_common(12):
    names = s.split(',') if s else []
    print(f'  {c:6d}  {len(names):3d} libs  last={names[-1] if names else "-"}  first={names[0] if names else "-"}')
nolib = sum(1 for r in rows if r['libs'] == '')
print('no lib file at all', nolib)
# 2. files
nf = collections.Counter(len(r['files'] or []) for r in rows)
print('non-lib files per instance:', sorted(nf.items())[:12], 'max', max(nf))
def norm(p): return p
same = 0; prefix = 0; extra = 0; reordered = 0; missing_root = 0
ex_reordered = []; ex_extra = []
for r in rows:
    files = [f['n'] for f in (r['files'] or [])]
    roots = r['roots'] or []
    if files == roots: same += 1; continue
    fs = set(files); rs = set(roots)
    if fs == rs: reordered += 1; ex_reordered.append(r['suite'] + '/' + r['name'])
    else:
        if fs - rs: extra += 1; ex_extra.append(r['suite'] + '/' + r['name'])
        if rs - fs: missing_root += 1
print(f'program non-lib files equal the roots in order: {same}; same set in another order: {reordered}; files beyond the roots: {extra}; roots that are not in the program: {missing_root}')
print('  reordered examples:', ex_reordered[:8])
print('  extra examples:', ex_extra[:8])
# lib files among roots (tests/lib via @libFiles)
# 3. resolutions
anyres = sum(1 for r in rows if any(f.get('res') for f in (r['files'] or [])))
okres = sum(1 for r in rows if any(any(len(x) > 3 for x in f.get('res', [])) for f in (r['files'] or [])))
unres = sum(1 for r in rows if any(any(len(x) == 3 for x in f.get('res', [])) for f in (r['files'] or [])))
extlib = sum(1 for r in rows if any(any(len(x) > 4 and x[4] for x in f.get('res', [])) for f in (r['files'] or [])))
pkg = sum(1 for r in rows if any(any(len(x) > 5 and x[5] for x in f.get('res', [])) for f in (r['files'] or [])))
modes = collections.Counter(x[1] for r in rows for f in (r['files'] or []) for x in f.get('res', []))
print(f'instances with a module name to resolve: {anyres}; with a resolved one: {okres}; with an unresolved one: {unres}; with an external library import: {extlib}; with a package id: {pkg}; modes {dict(modes)}')
# 4. metadata
fmt = collections.Counter(f['fmt'] for r in rows for f in (r['files'] or []))
pjt = collections.Counter(f.get('pjt', '') for r in rows for f in (r['files'] or []))
print('implied node format of non-lib files', dict(fmt), 'package.json type', dict(pjt))
print('instances with a file whose package.json type is set', sum(1 for r in rows if any(f.get('pjt') for f in (r['files'] or []))))
print('instances with a jsx runtime import', sum(1 for r in rows if any(f.get('jsx') for f in (r['files'] or []))), 'with an importHelpers import', sum(1 for r in rows if any(f.get('helpers') for f in (r['files'] or []))))
sk = collections.Counter(f['sk'] for r in rows for f in (r['files'] or []))
print('script kinds of non-lib files (1 JS, 2 JSX, 3 TS, 4 TSX, 6 JSON)', dict(sk))
print('instances with a JS or JSX file', sum(1 for r in rows if any(f['sk'] in (1, 2) for f in (r['files'] or []))), 'with a JSON file', sum(1 for r in rows if any(f['sk'] == 6 for f in (r['files'] or []))))
print('instances with a file from an external library (node_modules)', sum(1 for r in rows if any(f.get('ext') for f in (r['files'] or []))))
# 5. diagnostics by origin
cats = ['config', 'program', 'syntactic', 'bind', 'semantic', 'include', 'global', 'declaration', 'suggestion']
for c in cats:
    k = sum(1 for r in rows if r['diag'].get(c))
    t = sum(len(r['diag'].get(c) or []) for r in rows)
    print(f'  {c:12s} instances {k:6d} diagnostics {t:7d}')
E = [r for r in rows if r['used'] > 0]
def only_front(r):
    d = r['diag']
    return not d.get('config') and not d.get('program') and not d.get('include') and not d.get('declaration') and not d.get('suggestion')
print('instances with an error baseline', len(E), 'of which every diagnostic comes from the parser, the binder or the checker:', sum(1 for r in E if only_front(r)))
print('  with program diagnostics', sum(1 for r in E if r['diag'].get('program')), 'config', sum(1 for r in E if r['diag'].get('config')), 'include', sum(1 for r in E if r['diag'].get('include')), 'declaration', sum(1 for r in E if r['diag'].get('declaration')), 'suggestion', sum(1 for r in E if r['diag'].get('suggestion')))
C = [r for r in rows if r['used'] == 0]
print('instances without an error baseline', len(C))
print('pre != post count', sum(1 for r in rows if r['pre'] != r['post']), [r['suite'] + '/' + r['name'] for r in rows if r['pre'] != r['post']][:10])
pc = collections.Counter(c for r in rows for c in (r['diag'].get('program') or []))
print('program diagnostic codes', pc.most_common(40))
ic = collections.Counter(c for r in rows for c in (r['diag'].get('include') or []))
print('include processor diagnostic codes', ic.most_common(20))
cc = collections.Counter(c for r in rows for c in (r['diag'].get('config') or []))
print('config diagnostic codes', cc.most_common(20))
gc = collections.Counter(c for r in rows for c in (r['diag'].get('global') or []))
print('global diagnostic codes', gc.most_common(20))
dc = collections.Counter(c for r in rows for c in (r['diag'].get('declaration') or []))
print('declaration diagnostic codes', dc.most_common(20))
# 6. options
for k in ['target', 'module', 'moduleResolution', 'moduleDetection', 'jsx', 'noLib', 'skipLibCheck', 'skipDefaultLibCheck', 'noCheck', 'declaration', 'noEmit', 'isolatedModules', 'checkJs', 'allowJs', 'pretty', 'importHelpers', 'noResolve', 'incremental', 'composite']:
    print(f'  option {k}:', sorted(collections.Counter(json.dumps(r['options'].get(k)) for r in rows).items(), key=lambda x: -x[1])[:16])
print('  option lib set:', sum(1 for r in rows if r['options'].get('lib')), 'types set:', sum(1 for r in rows if r['options'].get('types')))
