#!/usr/bin/env python3
"""cmp.py og.out ng.out [--all] [--only=substr]: classifies differences per input and mode."""
import sys, re, collections
def load(p):
    d = collections.OrderedDict(); cur = None
    for line in open(p, encoding="utf8", errors="replace"):
        line = line.rstrip("\n")
        if line.startswith("## "):
            cur = line[3:]; d[cur] = {}
        elif cur is not None and line.startswith("  "):
            mode, rest = line[2:4], line[5:]
            d[cur][mode] = rest
    return d
og, ng = load(sys.argv[1]), load(sys.argv[2])
def parse(r):
    m = re.match(r"(ok(?::\w+)?|err:\S+|LEXERR)(?: @(\d+) (\w+) E(\d+))?", r)
    res, pos, tok, errs = m.group(1), m.group(2), m.group(3), m.group(4)
    meta = re.search(r" M=(\S+)", r); syms = re.search(r" S=(\S*)", r); n = re.search(r" n(\d+)$", r)
    msg = re.search(r" \[(.*?)\]( M=| S=| n\d+$)", r)
    return dict(res=res, pos=pos, tok=tok, errs=int(errs or 0), meta=meta and meta.group(1), syms=syms and syms.group(1), n=int(n.group(1)) if n else 0, msg=msg and msg.group(1))
cats = collections.defaultdict(list)
tok_og = tok_ng = 0
for form in og:
    for mode in og[form]:
        if mode in ("S+", "B+"): continue
        a, b = parse(og[form][mode]), parse(ng[form].get(mode, "LEXERR"))
        whole = "--whole" in sys.argv and mode.strip() not in ("a", "w")
        a_ok = a["res"].startswith("ok") and a["errs"] == 0 and (not whole or a["tok"] == "TEndOfFile")
        b_ok = b["res"].startswith("ok") and b["errs"] == 0 and (not whole or b["tok"] == "TEndOfFile")
        if a_ok and b_ok and a["res"] == b["res"]: tok_og += a["n"]; tok_ng += b["n"]
        rec = (form, mode, og[form][mode], ng[form][mode])
        if mode.strip() in ("a", "w") and a["res"] != b["res"]:
            cats["ATTEMPT flips true->false" if a["res"] == "ok:true" else "attempt flips false->true"].append(rec)
        elif a_ok and not b_ok: cats["REGRESSION accept->reject"].append(rec)
        elif a_ok and b_ok and (a["pos"], a["tok"]) != (b["pos"], b["tok"]): cats["CONSUMPTION differs (both accept)"].append(rec)
        elif a_ok and b_ok and a["meta"] != b["meta"]: cats["metadata differs"].append(rec)
        elif a_ok and b_ok and a["syms"] != b["syms"]: cats["symbols differ"].append(rec)
        elif not a_ok and b_ok: cats["newly accepted"].append(rec)
        elif not a_ok and not b_ok and (a["res"], a["pos"], a["errs"], a["msg"]) != (b["res"], b["pos"], b["errs"], b["msg"]): cats["rejected differently"].append(rec)
show_all = "--all" in sys.argv
only = [a.split("=",1)[1] for a in sys.argv if a.startswith("--only=")]
for cat, items in cats.items():
    forms = collections.OrderedDict()
    for f, m, a, b in items: forms.setdefault(f, []).append((m, a, b))
    print(f"=== {cat}: {len(items)} records, {len(forms)} forms")
    if only and not any(o in cat for o in only): continue
    for f, lst in list(forms.items())[: (10**9 if show_all else 40)]:
        print(f"  {f!r}  modes={','.join(m.strip() for m,_,_ in lst)}")
        m, a, b = lst[0]
        print(f"      og[{m}]: {a}\n      ng[{m}]: {b}")
print(f"tokens scanned where both accept: og {tok_og} ng {tok_ng} ({(tok_ng/max(tok_og,1)-1)*100:+.1f}%)")
