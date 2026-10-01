# Research probe: model of the default lib choice, the reference-lib closure and the lib order of compiler/fileloader.go and filesparser.go, checked against the file lists of the reference binary (vectors/program-order).
import os, re, sys, glob
D = "/workspace/ref/typescript-go/internal/bundled/libs"
src = open("/workspace/ref/typescript-go/internal/tsoptions/enummaps.go").read()
block = src[src.index("var LibMap"):src.index("var (")]
pairs = re.findall(r'\{Key: "([^"]+)", Value: "([^"]+)"\}', block)
LIBS = [k for k, _ in pairs]; LIBMAP = dict(pairs); LIBFILES = set(LIBMAP.values())
TARGET = {"esnext": "lib.esnext.full.d.ts", "es2015": "lib.es6.d.ts"}
for y in range(2016, 2026): TARGET[f"es{y}"] = f"lib.es{y}.full.d.ts"
def get_lib_file_name(name):
    name = name.lower()
    if name in LIBFILES: return name
    return LIBMAP.get(name)
def lib_refs(name):
    text = open(os.path.join(D, name), encoding="utf-8").read()
    return re.findall(r'^///\s*<reference\s+lib="([^"]+)"\s*/>', text, re.M)
def priority(name):
    if name in ("lib.d.ts", "lib.es6.d.ts"): return 0
    n = name[len("lib."):-len(".d.ts")]
    return LIBS.index(n) + 1 if n in LIBS else len(LIBS) + 2
def program_libs(root_libs):
    seen, out = set(), []
    def collect(names):
        for n in names:
            if n in seen: continue
            seen.add(n)
            collect([f for f in (get_lib_file_name(r) for r in lib_refs(n)) if f])
            out.append(n)
    collect(root_libs)
    prios = [priority(n) for n in out]
    ties = len(prios) - len(set(prios))
    return sorted(out, key=priority), ties   # sorted() is stable
ok = bad = 0; tie_total = 0
V = "/workspace/notes/lint/units/typecheck/end-to-end-k4-k5/vectors/program-order"
for path in sorted(glob.glob(V + "/*.txt")):
    base = os.path.basename(path)[:-4]
    if base.startswith("target-"):
        t = base[len("target-"):]
        roots = [TARGET.get("es2025" if t == "default" else t, "lib.d.ts")]
    else:
        roots = [get_lib_file_name(x) for x in base[len("lib-"):].split("+")]
    want = open(path).read().split()
    got, ties = program_libs(roots)
    tie_total += ties
    if got == want: ok += 1
    else:
        bad += 1; print("DIFF", base, len(got), len(want))
print("vectors equal", ok, "different", bad, "priority ties seen", tie_total, "libs entries", len(LIBS), "distinct files", len(LIBFILES), "files on disk", len(os.listdir(D)))
print("not in LibMap values:", sorted(set(os.listdir(D)) - LIBFILES))
