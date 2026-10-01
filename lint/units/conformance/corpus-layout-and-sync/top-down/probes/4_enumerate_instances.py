#!/usr/bin/env python3
import os
# Research probe. Rough port of the instance enumeration (72 varying options, 14,915 instances); writes instances.json.
W = os.environ.get("WORK", "/tmp/conf-research")
os.makedirs(W, exist_ok=True)
import re, subprocess, sys, collections, json, os

TS = os.environ.get("TS", "/workspace/ref/typescript-go/_submodules/TypeScript")
GO = os.environ.get("GO", "/workspace/ref/typescript-go")

# ---- option declarations
src = open(f"{GO}/internal/tsoptions/declscompiler.go", encoding="utf-8").read()
end = src.index("var optionsType")
body = src[:end]
decls = []
depth = 0
cur = None
for line in body.split("\n"):
    s = line.strip()
    if depth == 0:
        if line.startswith("var ") and line.rstrip().endswith("{"):
            depth = 1
        continue
    # inside a slice
    opens = line.count("{")
    closes = line.count("}")
    if depth == 1 and s == "{":
        cur = {}
        depth = 2
        continue
    if depth == 2 and s in ("},", "}"):
        decls.append(cur)
        cur = None
        depth = 1
        continue
    if depth == 1 and s == "}":
        depth = 0
        continue
    if depth >= 2:
        if depth == 2:
            m = re.match(r"^(\w+):\s*(.*?),?\s*(//.*)?$", s)
            if m:
                cur[m.group(1)] = m.group(2)
        depth += opens - closes
print("declared options", len(decls), "distinct names", len({d["Name"] for d in decls}))
AFFECTS = ["AffectsProgramStructure", "AffectsEmit", "AffectsModuleResolution", "AffectsBindDiagnostics",
           "AffectsSemanticDiagnostics", "AffectsSourceFile", "AffectsDeclarationPath", "AffectsBuildInfo"]
kinds = {}
vary = set()
for d in decls:
    name = d["Name"].strip('"')
    kind = d.get("Kind", "")
    kinds.setdefault(name.lower(), kind)
    if d.get("IsCommandLineOnly") == "true":
        continue
    if kind not in ("CommandLineOptionTypeBoolean", "CommandLineOptionTypeEnum"):
        continue
    if any(d.get(a) == "true" for a in AFFECTS):
        vary.add(name.lower())
vary |= {"noemit", "isolatedmodules"}
print("varyBy options", len(vary))
for extra in ["allowNonTsExtensions", "noErrorTruncation", "suppressOutputPathCheck", "noCheck"]:
    kinds.setdefault(extra.lower(), "CommandLineOptionTypeBoolean")

enum_src = open(f"{GO}/internal/tsoptions/enummaps.go", encoding="utf-8").read()
def enum_map(var):
    i = enum_src.index("var " + var + " ")
    j = enum_src.index("})", i)
    return collections.OrderedDict(re.findall(r'\{Key: "([^"]+)", Value: ([\w.]+)\}', enum_src[i:j]))
cl = open(f"{GO}/internal/tsoptions/commandlineoption.go", encoding="utf-8").read()
i = cl.index("var commandLineOptionEnumMap")
j = cl.index("\n}", i)
enum_of = {}
for k, v in re.findall(r'"(\w+)":\s*(\w+),', cl[i:j]):
    try:
        enum_of[k.lower()] = enum_map(v)
    except ValueError:
        pass
print("enum options", sorted(enum_of))

def value_of(option, value):
    kind = kinds.get(option)
    if kind is None:
        return None
    if kind == "CommandLineOptionTypeEnum":
        return enum_of[option].get(value.lower())
    if kind == "CommandLineOptionTypeBoolean":
        v = value.lower()
        return v if v in ("true", "false") else None
    return value

class Fatal(Exception):
    pass

def split_option_values(value, option):
    if len(value) == 0:
        return None
    star = False
    includes, excludes = [], []
    for s in value.split(","):
        s = s.strip()
        if not s:
            continue
        if s == "*":
            star = True
        elif s[0] in "-!":
            excludes.append(s[1:])
        else:
            includes.append(s)
    if not includes and not star and not excludes:
        return None
    variations = collections.OrderedDict()
    for inc in includes:
        v = value_of(option, inc)
        if v is None:
            raise Fatal(f"Unknown value '{inc}' for option '{option}'")
        variations.setdefault(v, inc)
    if star:
        kind = kinds.get(option)
        allv = list(enum_of[option]) if kind == "CommandLineOptionTypeEnum" else ["true", "false"]
        for inc in allv:
            v = value_of(option, inc)
            variations.setdefault(v, inc)
    for exc in excludes:
        v = value_of(option, exc)
        if v is None:
            continue
        variations.pop(v, None)
    if not variations:
        raise Fatal("empty set")
    return list(variations.values())

option_rx = re.compile(r"^//\s*@(\w+)\s*:\s*([^\r\n]*)", re.M)

def go_trim(s):
    return s.strip(" \t\n\v\f\r\x85\xa0")

def settings_of(content):
    opts = collections.OrderedDict()
    for m in option_rx.finditer(content):
        v = go_trim(m.group(2))
        if v.endswith(";"):
            v = v[:-1]
        opts[m.group(1).lower()] = v
    return opts

def configurations(settings):
    entries = []
    count = 1
    nonvary = {}
    for option, value in settings.items():
        if option in vary:
            e = split_option_values(value, option)
            if e and len(e) > 1:
                count *= len(e)
                if count > 25:
                    raise Fatal("too many variations")
                entries.append((option, e))
            elif e and len(e) == 1:
                nonvary[option] = e[0]
        else:
            nonvary[option] = value
    configs = []
    if entries:
        def rec(idx, state):
            if idx >= len(entries):
                configs.append(dict(state))
                return
            k, vals = entries[idx]
            for v in vals:
                state[k] = v
                rec(idx + 1, state)
        rec(0, {})
        out = []
        for c in configs:
            desc = ",".join(f"{k}={c[k].lower()}" for k in sorted(c))
            c2 = dict(c)
            c2.update(nonvary)
            out.append((desc, c2))
        return out
    elif nonvary:
        return [("", nonvary)]
    return []

skipped_names = set(re.findall(r'^\t"([^"]+\.tsx?)",$', open(f"{GO}/internal/testrunner/compiler_runner.go").read().split("var skippedTests")[1].split("}")[0], re.M))
print("skipped by name list", len(skipped_names))

def lsfiles():
    out = subprocess.run(["git", "-C", TS, "ls-tree", "-r", "-z", "--name-only", "HEAD", "--", "tests/cases/conformance", "tests/cases/compiler"],
                         check=True, capture_output=True).stdout
    return [p.decode() for p in out.split(b"\0") if p]

def read(path):
    return open(f"{TS}/{path}", "rb").read()

instances = []
fatal = []
nfiles = 0
skipped_by_name_files = 0
for path in lsfiles():
    if not re.search(r"\.tsx?$", path):
        continue
    nfiles += 1
    base = path.rsplit("/", 1)[1]
    raw = read(path)
    # the harness reads through the vfs, which decodes; BOM handling is ignored here
    if raw[:2] == b"\xff\xfe":
        content = raw[2:len(raw) - (len(raw) % 2)].decode("utf-16-le", "replace")
    elif raw[:2] == b"\xfe\xff":
        content = raw[2:len(raw) - (len(raw) % 2)].decode("utf-16-be", "replace")
    else:
        if raw[:3] == b"\xef\xbb\xbf":
            raw = raw[3:]
        content = raw.decode("utf-8", "replace")
    if base in skipped_names:
        skipped_by_name_files += 1
        by_name = True
    else:
        by_name = False
    try:
        cfgs = configurations(settings_of(content))
    except Fatal as e:
        fatal.append((path, str(e)))
        cfgs = []
    if not cfgs:
        cfgs = [("", {})]
    stem = re.sub(r"\.tsx?$", "", base)
    for desc, cfg in cfgs:
        name = stem if desc == "" else f"{stem}({desc})"
        instances.append({"path": path, "suite": path.split("/")[2], "name": name, "desc": desc, "cfg": cfg, "by_name": by_name,
                          "lib_in_content": "/.lib/" in content})
print("test files", nfiles, "skipped-by-name files", skipped_by_name_files)
print("instances incl. skipped-by-name", len(instances), "excl.", sum(1 for i in instances if not i["by_name"]))
print("fatal", fatal[:10], len(fatal))
json.dump(instances, open(W + "/instances.json", "w"))
