# Research probe: checker and binder functions that a run of the reference enters, by layer in the order of K3 (typecheck.md).
# usage: k3order.py <go tool covdata func list> [two-digit layer numbers to list by name]
# Needs ../../drivers-k4-k5/bottom-up/py/layermap.py (layer of a function by file and line) and a function inventory with line
# counts (/tmp/tcinv/funcs.jsonl: pkg, file, start, lines; rebuild it with the outline probe of checker-core-scratch if it is gone).
import collections, json, os, re, sys
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "../../drivers-k4-k5/bottom-up/py"))
from layermap import layer_of
ORDER = [
 ("01 data model", ["TYPES","LINKS","MAPPER"]),
 ("02 utilities", ["UTIL"]),
 ("03 type keys, object types", ["T-KEYS","K-OBJ"]),
 ("04 resolution stack", ["T-RSTACK"]),
 ("05 init and globals", ["C-INIT","N-DIAG","D-SINK"]),
 ("06 symbol merging", ["S-MERGE"]),
 ("07 name resolution", ["N-RESOLVE"]),
 ("08 aliases and modules", ["A-ALIAS","M-MODULE","Q-ENTITY"]),
 ("09 literal, union, intersection", ["K-LIT","K-PRED","K-GENERIC","K-UNION","K-INTERSECT"]),
 ("10 tuples", ["T-TUPLE"]),
 ("11 declared types", ["T-DECLARED","T-ENUMVAL"]),
 ("12 type nodes to types", ["T-TYPENODE"]),
 ("13 constraints", ["T-CONSTRAINT"]),
 ("14 base types", ["T-BASE"]),
 ("15 members", ["T-MEMBERS","T-UIMEMBERS"]),
 ("16 lookup", ["T-LOOKUP"]),
 ("17 apparent types", ["T-APPARENT"]),
 ("18 signatures", ["T-SIGDECL","T-SIGSHAPE","T-SIGINST"]),
 ("19 instantiation", ["T-INSTANTIATE"]),
 ("20 types of symbols", ["T-SYMTYPE","T-JSDECL"]),
 ("21 widening", ["T-WIDEN"]),
 ("22 type printer", ["P-PRINT","checker:symboltracker.go"]),
 ("23 relations", ["R-REL","R-DISCRIM","R-VARIANCE","R-SIGREL"]),
 ("24 elaboration", ["R-ELAB"]),
 ("25 expressions to contextual", ["E-CORE","E-LITERAL","E-OPER","E-ACCESS","E-COLLIDE","E-FACTS","E-FUNC","T-RETINFER","E-CALL","I-INFER","I-REVMAP","E-CTX"]),
 ("26 flow, reachability", ["F-NARROW","F-REACH"]),
 ("27 keyof to template", ["K-KEYOF","K-INDEXED","K-SUBST","K-COND","T-MAPPED","K-TEMPLATE","K-IMPORTTYPE"]),
 ("28 iteration, async", ["D-ITER","E-AWAIT"]),
 ("29 JSX", ["X-JSX"]),
 ("30 decorators", ["E-DECOR","D-DECOR"]),
 ("31 declaration checks", ["D-DRIVER","D-VAR","D-CLASS","D-ENUMNS","D-IMPEXP","D-FUNC","D-STMT","D-TYPENODE","D-JSDOC","D-HELPERS","U-ALIASMARK"]),
 ("32 unused, unreachable", ["D-UNUSED","F-UNREACH"]),
 ("33 grammar", ["G-GRAMMAR"]),
]
inv = {}
if os.path.exists("/tmp/tcinv/funcs.jsonl"):
    for l in open("/tmp/tcinv/funcs.jsonl"):
        d = json.loads(l); inv[(d["pkg"] + "/" + d["file"], d["start"])] = d["lines"]
by = collections.defaultdict(list)
for ln in open(sys.argv[1]):
    m = re.match(r'.*typescript-go/internal/(\S+?):(\d+):\s+(\S+)\s+([\d.]+)%', ln)
    if not m or float(m.group(4)) == 0: continue
    f, line, name = m.group(1), int(m.group(2)), m.group(3)
    if not (f.startswith("checker/") or f.startswith("binder/")): continue
    by[layer_of(f, line)].append((f, line, name, inv.get((f, line), 0)))
cum_f = cum_l = 0; seen = set(); last = None
for title, layers in ORDER:
    f = sum(len(by[l]) for l in layers); ln = sum(x[3] for l in layers for x in by[l]); cum_f += f; cum_l += ln; seen.update(layers)
    if f: last = title
    print(f"{title:32s} fn={f:4d} lines={ln:5d} cum_fn={cum_f:4d} cum_lines={cum_l:5d}")
for l, v in sorted(by.items()):
    if l not in seen: print(f"  other: {l} fn={len(v)} lines={sum(x[3] for x in v)}")
print("last layer entered:", last)
for title, layers in ORDER:
    if title[:2] in sys.argv[2:]:
        for l in layers:
            for x in by[l]: print("   ", title[:2], l, f"{x[2]}@{x[0].split('/')[1]}:{x[1]}", x[3])
