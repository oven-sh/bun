# Research probe: the closure of a default lib in upstream's load order and in the order after sortLibs.
# usage: libclosure.py <lib file name, default lib.es2025.full.d.ts> [src|bundled]
import re, sys, os, json
REF = '/workspace/ref/typescript-go/'
src = open(REF + 'internal/tsoptions/enummaps.go').read()
block = src[src.index('var LibMap'):src.index('var (\n\tLibs')]
LIBMAP = re.findall(r'\{Key: "([^"]+)", Value: "([^"]+)"\}', block)
LIBS = [k for k, _ in LIBMAP]
KEYMAP = dict(LIBMAP)
FILES = set(v for _, v in LIBMAP)
def get_lib_file_name(name):
    name = name.lower()
    if name in FILES: return name
    return KEYMAP.get(name)
mode = sys.argv[2] if len(sys.argv) > 2 else 'src'
SRC = REF + '_submodules/TypeScript/src/lib/'
BUN = REF + 'internal/bundled/libs/'
libsjson = re.sub(r'//[^\n]*', '', open(SRC + 'libs.json').read())
lj = json.loads(libsjson)
REV = {}
for n in lj['libs']:
    target = lj['paths'].get(n, 'lib.' + n + '.d.ts')
    REV[target] = n + '.d.ts'
def path_of(file):
    return (SRC + REV[file]) if mode == 'src' else (BUN + file)
start = sys.argv[1] if len(sys.argv) > 1 else 'lib.es2025.full.d.ts'
seen = {}; post = []; unknown = []
REFRE = re.compile(r'^///\s*<reference\s+lib\s*=\s*["\']([^"\']+)["\']\s*/>', re.M)
def visit(file):
    if file in seen: return
    seen[file] = True
    text = open(path_of(file), encoding='utf-8').read()
    for m in REFRE.finditer(text):
        f = get_lib_file_name(m.group(1))
        if f is None: unknown.append((file, m.group(1))); continue
        visit(f)
    post.append(file)
visit(start)
def prio(file):
    if file in ('lib.d.ts', 'lib.es6.d.ts'): return 0
    name = file[len('lib.'):-len('.d.ts')]
    return LIBS.index(name) + 1 if name in LIBS else len(LIBS) + 2
srt = sorted(post, key=prio)
assert len(set(prio(f) for f in post)) == len(post), 'ties'
print('libs keys', len(LIBS), 'lib files', len(FILES), 'libs.json entries', len(lj['libs']))
print('closure', len(post), 'bytes', sum(os.path.getsize(path_of(f)) for f in post), 'unknown', unknown)
print('load order (post-order):')
for i, f in enumerate(post): print(' ', i, f, prio(f))
print('program order (sortLibs):')
for i, f in enumerate(srt): print(' ', i, f, prio(f), os.path.basename(path_of(f)))
