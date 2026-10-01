import os
# Research probe. The same count with the units split as the harness does, so that only compiled units are searched.
W = os.environ.get("WORK", "/tmp/conf-research")
os.makedirs(W, exist_ok=True)
import json, re, collections
TS = os.environ.get("TS", "/workspace/ref/typescript-go/_submodules/TypeScript")
lib = json.load(open(W + "/lib-instances.json"))
inst = {(i["suite"], i["name"]): i for i in json.load(open(W + "/instances.json")) if not i["by_name"]}
option_rx = re.compile(r"^//\s*@(\w+)\s*:\s*([^\r\n]*)")
link_rx = re.compile(r"^//\s*@link\s*:\s*([^\r\n]*)\s*->\s*([^\r\n]*)")
def decode(raw):
    if raw[:2] == b"\xff\xfe": return raw[2:].decode("utf-16-le", "replace")
    if raw[:2] == b"\xfe\xff": return raw[2:].decode("utf-16-be", "replace")
    if raw[:3] == b"\xef\xbb\xbf": raw = raw[3:]
    return raw.decode("utf-8", "replace")
def units(code, file_name):
    out = []; cur = None; name = ""; 
    buf = []
    for line in re.split(r"\r?\n", code):
        if link_rx.match(line): continue
        m = option_rx.match(line)
        if m:
            k = m.group(1).lower(); v = m.group(2).strip()
            if k != "filename": continue
            if name != "":
                out.append((name, "\n".join(buf)))
            buf = []; name = v
        else:
            buf.append(line)
    if not out and name == "":
        name = file_name.rsplit("/", 1)[1]
    out.append((name, "\n".join(buf)))
    return out
files = collections.OrderedDict()
for l in lib:
    files.setdefault(l["path"], []).append(l)
mounted_files = 0; not_mounted = []; tsconfig = []
for path, ls in files.items():
    code = decode(open(f"{TS}/{path}", "rb").read())
    us = units(code, path)
    if any(n.rsplit("/",1)[-1].lower() in ("tsconfig.json", "jsconfig.json") for n, _ in us):
        tsconfig.append(path)
    us2 = [(n, c) for n, c in us if n.rsplit("/",1)[-1].lower() not in ("tsconfig.json", "jsconfig.json")]
    cfg = inst[(ls[0]["suite"], ls[0]["name"])]["cfg"]
    last = us2[-1][1]
    if cfg.get("noimplicitreferences", "") != "" or "require(" in last or re.search(r"reference\spath", last):
        compiled = [us2[-1]]
    else:
        compiled = us2
    if any("/.lib/" in c for _, c in compiled):
        mounted_files += 1
    else:
        not_mounted.append(path)
print("case files naming /.lib/:", len(files), "| mounted by the harness rule (a compiled unit contains /.lib/):", mounted_files)
print("not mounted:", not_mounted)
print("with a tsconfig unit:", tsconfig)
n_inst = sum(len(ls) for p, ls in files.items() if p not in not_mounted)
n_run = sum(1 for p, ls in files.items() if p not in not_mounted for l in ls if l["ran"])
print("instances that mount /.lib:", n_inst, "of which run:", n_run)
