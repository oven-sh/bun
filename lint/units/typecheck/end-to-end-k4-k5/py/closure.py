# Research probe: lib closure and program order of a default lib file, as filesparser.go collects and sorts it.
import re, sys, os
D = "/workspace/ref/typescript-go/internal/bundled/libs"
src = open("/workspace/ref/typescript-go/internal/tsoptions/enummaps.go").read()
block = src[src.index("var LibMap"):src.index("var (")]
pairs = re.findall(r'\{Key: "([^"]+)", Value: "([^"]+)"\}', block)
libs = [k for k, _ in pairs]
libmap = dict(pairs)
files = set(libmap.values())
def lib_file_name(name):
    name = name.lower()
    if name in files: return name
    return libmap.get(name)
def closure(root):
    seen, order = set(), []
    def visit(name):
        if name in seen: return
        seen.add(name)
        text = open(os.path.join(D, name), encoding="utf-8").read()
        for m in re.finditer(r'^///\s*<reference\s+lib="([^"]+)"\s*/>', text, re.M):
            f = lib_file_name(m.group(1))
            if f: visit(f)
        order.append(name)
    visit(root)
    return order
def priority(name):
    if name in ("lib.d.ts", "lib.es6.d.ts"): return 0
    n = name[len("lib."):-len(".d.ts")]
    return libs.index(n) + 1 if n in libs else len(libs) + 2
for root in sys.argv[1:]:
    post = closure(root)
    srt = sorted(post, key=priority)
    size = sum(os.path.getsize(os.path.join(D, f)) for f in post)
    print(f"{root}: {len(post)} files, {size} bytes; first {srt[:3]} last {srt[-2:]}")
    if os.environ.get("LIST"):
        print("\n".join(srt))
print("libs entries", len(libs), "distinct files", len(files))
