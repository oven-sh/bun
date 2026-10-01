# Splits TypeScript's test cases into units as the harness of the reference does (internal/testrunner/test_case_parser.go),
# in the two layouts that the stored goldens were made from. Used by replay.sh; reads the reference only.
# usage: python3 split_cases.py corpus <out dir> <manifest.tsv>        every unit of every case: c<case>u<unit>_<name>
#        python3 split_cases.py selection <SELECTION.tsv> <out dir> <args file>   the units of the binder selection
import os, re, sys

ROOT = "/workspace/ref/typescript-go/_submodules/TypeScript/tests/cases"
# JavaScript's \s and \w, which the two splitters were written with
WS = "\t\n\x0b\x0c\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff"
OPTION = re.compile(r"^/{2}[" + WS + r"]*@([A-Za-z0-9_]+)[" + WS + r"]*:[" + WS + r"]*([^\r\n]*)")
LINK = re.compile(r"^/{2}[" + WS + r"]*@link[" + WS + r"]*:[" + WS + r"]*([^\r\n]*)[" + WS + r"]*->[" + WS + r"]*([^\r\n]*)")
STRIP = "".join(chr(c) for c in [9, 10, 11, 12, 13, 32, 0xa0, 0x1680, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff] + list(range(0x2000, 0x200b)))
LINES = re.compile(r"\r?\n")


def walk(d):
    for name in sorted(os.listdir(d)):
        p = os.path.join(d, name)
        if os.path.isdir(p):
            yield from walk(p)
        else:
            yield p


def decode(b):
    if b[:2] == b"\xff\xfe":
        return b[2:].decode("utf-16-le", errors="replace")
    if b[:2] == b"\xfe\xff":
        return b[2:].decode("utf-16-be", errors="replace")
    if b[:3] == b"\xef\xbb\xbf":
        return b[3:].decode("utf-8", errors="replace")
    return b.decode("utf-8", errors="replace")


def split_corpus(code, file_name):
    # ts-dump-and-test-importer/top-down/probe/mkcorpus.mjs
    units = []
    cur, name = None, ""
    for line in LINES.split(code):
        if LINK.match(line):
            continue
        m = OPTION.match(line)
        if m:
            if m.group(1).lower() != "filename":
                continue
            if name != "":
                units.append((name, cur or ""))
            cur = None
            name = m.group(2).strip(STRIP)
        else:
            cur = line if cur is None or len(cur) == 0 else cur + "\n" + line
    if not units and name == "":
        name = os.path.basename(file_name)
    units.append((name, cur or ""))
    return units


def split_selection(code, file_name):
    # binder-port-and-fixtures/prototype/units.mjs
    units = []
    current, content = None, ""
    for line in LINES.split(code):
        m = OPTION.match(line)
        if m:
            if m.group(1).lower() != "filename":
                continue
            if current is not None:
                units.append((current, content))
            current = m.group(2).strip(STRIP)
            content = ""
            continue
        if len(content) != 0:
            content += "\n"
        content += line
    units.append((current if current is not None else os.path.basename(file_name), content))
    return units


EXTS = [".d.ts", ".d.mts", ".d.cts", ".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]
if sys.argv[1] == "corpus":
    out, manifest = sys.argv[2], sys.argv[3]
    os.makedirs(out, exist_ok=True)
    rows = []
    idx = 0
    for suite in ["conformance", "compiler"]:
        for f in walk(os.path.join(ROOT, suite)):
            units = split_corpus(decode(open(f, "rb").read()), f)
            ci = idx
            idx += 1
            ui = 0
            for name, content in units:
                if not any(name.lower().endswith(e) for e in EXTS):
                    continue
                base = re.sub(r"[^A-Za-z0-9_.\-]", "_", name.rsplit("/", 1)[-1])
                vname = "c%05du%d_%s" % (ci, ui, base)
                ui += 1
                with open(os.path.join(out, vname), "w", encoding="utf-8", newline="") as o:
                    o.write(content)
                rows.append("%s\t%s\t%s" % (vname, os.path.relpath(f, ROOT), name))
    open(manifest, "w", encoding="utf-8").write("\n".join(rows) + "\n")
    print("cases", idx, "units", len(rows))
else:
    selection, out, args = sys.argv[2], sys.argv[3], sys.argv[4]
    lines = []
    for row in open(selection, encoding="utf-8").read().split("\n")[1:]:
        if not row:
            continue
        f = row.split("\t")
        rel, index, virtual = f[1], int(f[4]), f[12]
        path = os.path.join(ROOT, rel)
        units = split_selection(open(path, "rb").read().decode("utf-8"), path)
        target = os.path.join(out, virtual)
        os.makedirs(os.path.dirname(target), exist_ok=True)
        with open(target, "w", encoding="utf-8", newline="") as o:
            o.write(units[index][1])
        lines.append("%s=%s" % (virtual, target))
    open(args, "w").write("\n".join(lines) + "\n")
    print("units", len(lines))
