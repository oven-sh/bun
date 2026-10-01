# Research probe: the lib files of every instance recomputed from its options (default lib by target or the lib list,
# closure over reference lib, priority order) and compared with the program that the reference built.
import json, re, collections
REF = '/workspace/ref/typescript-go/'
src = open(REF + 'internal/tsoptions/enummaps.go').read()
block = src[src.index('var LibMap'):src.index('var (\n\tLibs')]
LIBMAP = re.findall(r'\{Key: "([^"]+)", Value: "([^"]+)"\}', block)
LIBS = [k for k, _ in LIBMAP]; KEYMAP = dict(LIBMAP); FILES = set(v for _, v in LIBMAP)
def get_lib_file_name(name):
    name = name.lower()
    if name in FILES: return name
    return KEYMAP.get(name)
TARGET = {99: 'lib.esnext.full.d.ts', 12: 'lib.es2025.full.d.ts', 11: 'lib.es2024.full.d.ts', 10: 'lib.es2023.full.d.ts', 9: 'lib.es2022.full.d.ts',
          8: 'lib.es2021.full.d.ts', 7: 'lib.es2020.full.d.ts', 6: 'lib.es2019.full.d.ts', 5: 'lib.es2018.full.d.ts', 4: 'lib.es2017.full.d.ts',
          3: 'lib.es2016.full.d.ts', 2: 'lib.es6.d.ts'}
BUN = REF + 'internal/bundled/libs/'
REFRE = re.compile(r'^///\s*<reference\s+lib\s*=\s*["\']([^"\']+)["\']\s*/>', re.M)
refs_cache = {}
def refs(file):
    if file not in refs_cache:
        text = open(BUN + file, encoding='utf-8').read()
        refs_cache[file] = [get_lib_file_name(m.group(1)) for m in REFRE.finditer(text)]
    return refs_cache[file]
def prio(file):
    if file in ('lib.d.ts', 'lib.es6.d.ts'): return 0
    name = file[len('lib.'):-len('.d.ts')]
    return LIBS.index(name) + 1 if name in LIBS else len(LIBS) + 2
def closure(starts):
    seen = set(); post = []
    def visit(f):
        if f is None or f in seen: return
        seen.add(f)
        for g in refs(f): visit(g)
        post.append(f)
    for s in starts: visit(s)
    return sorted(post, key=prio)
rows = [json.loads(l) for l in open('/tmp/k4drv/k5/out/manifest.jsonl')]
ok = bad = skipped = 0; bads = []
for r in rows:
    o = r['options']
    if any(f.get('librefs') for f in (r['files'] or [])): skipped += 1; continue
    if o['noLib'] == 2 or not r['roots']: exp = []
    elif o.get('lib') is None: exp = closure([TARGET.get(o['target'], 'lib.d.ts')])
    else: exp = closure([get_lib_file_name(x) for x in o['lib']])
    got = r['libs'].split(',') if r['libs'] else []
    if exp == got: ok += 1
    else:
        bad += 1; bads.append((r['suite'] + '/' + r['name'], o.get('lib'), o['target'], o['noLib'], len(exp), len(got), [x for x in got if x not in exp][:5], [x for x in exp if x not in got][:5]))
print('recomputed lib list equals the program:', ok, 'differs:', bad, 'skipped (a non-lib file has reference lib):', skipped)
for b in bads[:20]: print(' ', b)
