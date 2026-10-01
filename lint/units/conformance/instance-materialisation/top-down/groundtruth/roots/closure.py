import os, re, sys
REF = "/workspace/ref/typescript-go"
MOD = "github.com/microsoft/typescript-go/"
start = sys.argv[1:]
seen = set()
ext = {}
todo = list(start)
imp_re = re.compile(r'^\s*(?:[A-Za-z_\.][A-Za-z0-9_]*\s+)?"([^"]+)"')
def imports_of(path):
    out = []
    with open(path, encoding="utf8") as f:
        src = f.read()
    # crude: find import blocks
    for m in re.finditer(r'^import\s*\(\s*(.*?)^\)', src, re.S | re.M):
        for line in m.group(1).splitlines():
            mm = imp_re.match(line)
            if mm: out.append(mm.group(1))
    for m in re.finditer(r'^import\s+(?:[A-Za-z_\.][A-Za-z0-9_]*\s+)?"([^"]+)"', src, re.M):
        out.append(m.group(1))
    return out
def build_ok(path, src_head):
    return True
while todo:
    p = todo.pop()
    if p in seen: continue
    seen.add(p)
    d = os.path.join(REF, p)
    if not os.path.isdir(d):
        print("MISSING", p); continue
    for fn in sorted(os.listdir(d)):
        if not fn.endswith(".go") or fn.endswith("_test.go"): continue
        if re.search(r'_(windows|darwin|js|wasm|plan9|freebsd|netbsd|openbsd|solaris|aix|dragonfly|illumos|ios|android)(_[a-z0-9]+)?\.go$', fn): continue
        for imp in imports_of(os.path.join(d, fn)):
            if imp.startswith(MOD):
                todo.append(imp[len(MOD):])
            elif "." in imp.split("/")[0]:
                ext.setdefault(imp, set()).add(p + "/" + fn)
print("INTERNAL", len(seen))
for p in sorted(seen): print("  ", p)
print("EXTERNAL")
for k in sorted(ext): print("  ", k, "<-", sorted(ext[k])[:4])
