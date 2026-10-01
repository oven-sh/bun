#!/usr/bin/env python3
"""triage.py og.out ng.out: differences that are not one of the known intended kinds."""
import sys, re, collections
sys.argv.append("--quiet")
def load(p):
    d = collections.OrderedDict(); cur = None
    for line in open(p, encoding="utf8", errors="replace"):
        line = line.rstrip("\n")
        if line.startswith("## "): cur = line[3:]; d[cur] = {}
        elif cur is not None and line.startswith("  "): d[cur][line[2:4]] = line[5:]
    return d
def parse(r):
    m = re.match(r"(ok(?::\w+)?|err:\S+|LEXERR)(?: @(\d+) (\w+) E(\d+))?", r)
    meta = re.search(r" M=(\S+)", r); syms = re.search(r" S=(\S*)", r)
    return dict(res=m.group(1), pos=int(m.group(2) or -1), tok=m.group(3), errs=int(m.group(4) or 0), meta=meta and meta.group(1), syms=syms and syms.group(1))
RESERVED = {"TBreak","TCase","TCatch","TClass","TConst","TContinue","TDebugger","TDefault","TDelete","TDo","TElse","TEnum","TExport","TExtends","TFinally","TFor","TFunction","TIf","TIn","TInstanceof","TReturn","TSuper","TSwitch","TThrow","TTry","TVar","TWhile","TWith"}
og, ng = load(sys.argv[1]), load(sys.argv[2])
counts = collections.Counter(); shown = 0
for form in og:
    for mode, ra in og[form].items():
        if mode in ("S+", "B+"): continue
        a, b = parse(ra), parse(ng[form][mode])
        a_ok = a["res"].startswith("ok") and a["errs"] == 0
        b_ok = b["res"].startswith("ok") and b["errs"] == 0
        kind = None
        if mode.strip() in ("a", "w"):
            if a["res"] == "ok:true" and b["res"] != "ok:true": kind = "ATTEMPT true->false"
            elif a["res"] == "ok:true" and a["pos"] != b["pos"]: kind = "ATTEMPT consumption"
        elif a_ok and (not b_ok or (a["pos"], a["tok"]) != (b["pos"], b["tok"])):
            if a["tok"] in RESERVED: kind = None; counts["known: reserved word is a type name"] += 1
            elif a["tok"] == "TLessThan" and "import" in form: kind = None; counts["known: type arguments after an import type"] += 1
            elif a["tok"] == "TQuestion" and "infer" in form: kind = None; counts["known: the constraint of infer is a whole type"] += 1
            else: kind = "REGRESSION" if not b_ok else "CONSUMPTION"
        if kind:
            counts[kind] += 1
            if shown < 60:
                shown += 1
                print(f"{kind}: {form!r} [{mode}]\n    og: {ra[:150]}\n    ng: {ng[form][mode][:150]}")
print(dict(counts))
