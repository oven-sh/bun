#!/usr/bin/env python3
"""Compare a JSX output matrix against the one recorded on main.

usage: diff.py <main.jsonl> <pr.jsonl> [--stage=a|b] [--twin=<main-twin.jsonl>] [--show=N]

Stage a (the carrier, no rule change): every cell must equal main, except
  R1  entry `run-run` may equal what `run-file` prints on main for the same
      tsconfig / bunfig / flags / NODE_ENV. On main `bun run` loads bunfig.toml
      after the flags and the load overwrites them; `bun <file>` does not.
  R2  in `build`, `build-env` and `no-bundle` under NODE_ENV=production, with a
      tsconfig.json that states no development, no bunfig.toml and no --jsx-*
      option, the cell may equal main's cell beside a bunfig.toml without jsx
      keys (production runtime). On main the whole-Pragma copy of such a
      tsconfig writes development=true back over what NODE_ENV chose (#38050).
  R3  the package of the `createElement` fallback (a "key" after a spread) and
      the classic import of `Bun.Transpiler#scanImports` follow the
      jsxImportSource of a tsconfig.json on every path (#38050). The cell may
      equal main's with "react" (or the user's package) replaced by the
      tsconfig's package in those two places.
Stage b (the rule): a tsconfig.json does not decide an option that bunfig.toml,
a --jsx-* flag or Bun.build({jsx}) states. The cell must equal what main prints
beside the tsconfig.json state that is left when those options are taken out of
it (its "twin"), with R1 to R3 as in stage a. For the special matrix the twin
outputs come from `special.ts --twin` run on main (--twin=<file>).
Exit code 0 when no other cell differs.
"""
import json, sys, collections, re

def load(path):
    d = {}
    for l in open(path):
        l = l.strip()
        if not l: continue
        r = json.loads(l)
        d[r["key"]] = r["out"]
    return d

args = [a for a in sys.argv[1:] if not a.startswith("--")]
opts = dict(a[2:].split("=", 1) for a in sys.argv[1:] if a.startswith("--") and "=" in a)
main, pr = load(args[0]), load(args[1])
stage = opts.get("stage", "a")
show = int(opts.get("show", "40"))
real_main = main
if stage == "b" and "twin" in opts:
    main = load(opts["twin"])
    moved_by_rule = sum(1 for k in main if real_main.get(k) != main[k])
    print(f"the rule moves {moved_by_rule} of {len(main)} cells (twin fixtures against the real ones, on main)")

TS_STATES = {  # runtime, development, factory and fragment, import source
    "none": (None, None, False, False),
    "empty": (None, None, False, False),
    "react-jsx": ("A", False, False, False),
    "react-jsxdev": ("A", True, False, False),
    "classic-th": ("C", None, True, False),
    "src-tsrc": ("A", False, False, True),
    "only-src-tsrc": (None, None, False, True),
}
BF_STATES = {"classic-bh": ("C", None, True, False), "react-jsx": ("A", False, False, False),
             "react-jsxDEV": ("A", True, False, False), "src-bsrc": (None, None, False, True)}
FL_STATES = {"classic-fh": ("C", None, True, False), "src-fsrc": (None, None, False, True),
             "automatic": ("A", None, False, False)}
API_STATES = {"classic-ah": ("C", None, True, False), "src-asrc": (None, None, False, True),
              "dev-true": (None, True, False, False), "dev-false": (None, False, False, False),
              "automatic": ("A", None, False, False)}
NOTHING = (None, None, False, False)
SPECIAL = set("NXOMTWVE")

def is_main_matrix(key):
    p = key.split("|")
    return len(p) == 5 and p[0] in TS_STATES

def user_states(bf, fl, entry):
    """(runtime, states development, states factory, states import source) of the user's sources."""
    if entry.startswith("api-"):
        r, d, f, i = API_STATES.get(entry[4:], NOTHING)
        return r, d is not None, f, i
    br, bd, bff, bi = BF_STATES.get(bf, NOTHING)
    fr, _, ff, fi = FL_STATES.get(fl, NOTHING)
    valued_flag = fl in FL_STATES
    # a valued flag brings its own development default (production): bunfig.toml's statement stays in force
    # only where it says the same
    return fr or br, (bd is not None) and (not valued_flag or bd is False), bff or ff, bi or fi

def twin_of(key):
    ts, bf, fl, ne, entry = key.split("|")
    if ts == "none": return key
    ur, ud, uf, ui = user_states(bf, fl, entry)
    tr, td, tf, ti = TS_STATES[ts]
    masked = (None if ur else tr, None if ud else td, tf and not uf, ti and not ui)
    if masked == TS_STATES[ts]: return key
    runtime = ur or masked[0] or "A"
    if runtime == "C":
        twin = "classic-th" if masked[2] else "empty"
    else:
        twin = {(None, False): "empty", (None, True): "only-src-tsrc", (False, False): "react-jsx",
                (True, False): "react-jsxdev", (False, True): "src-tsrc"}[(masked[1], masked[3])]
    return "|".join([twin, bf, fl, ne, entry])

# R3: where the package of createElement and of the classic import shows in an output.
PACKAGE_SPOTS = [
    re.compile(r'(createElement(?: as \w+)? \} from ")([^"]+)(")'),          # build, no-bundle, Bun.build
    re.compile(r'(classic-import:)([^.;]+)(\.createElement)'),                 # marks of a run
    re.compile(r'(\{"kind":"require-call","path":")([^"/]+)("\}\])'),          # scanImports: the last record
]
def with_package(out, package):
    for spot in PACKAGE_SPOTS:
        out = spot.sub(lambda m: m.group(1) + package + m.group(3), out)
    return out

NO_DEVELOPMENT_TS = {"empty", "only-src-tsrc", "classic-th"}
def allowed(key, out, base):
    """Why `out` may differ from base[key], or None."""
    p = key.split("|")
    if len(p) != 5: return None
    ts, bf, fl, ne, entry = p
    candidates = [(base.get(key), "")]
    if entry == "run-run":
        twin = "|".join([ts, bf, fl, ne, "run-file"])
        candidates.append((base.get(twin), "R1 run-run equals run-file"))
    if is_main_matrix(key) and entry in ("build", "build-env", "no-bundle") and ne == "production" \
            and ts in NO_DEVELOPMENT_TS and bf == "none" and fl in ("none", "side-effects"):
        twin = "|".join([ts, "nojsx", fl, ne, entry])
        candidates.append((base.get(twin), "R2 production beside a tsconfig without development"))
    for text, why in candidates:
        if text is None: continue
        if text == out:
            if why: return why
            continue
        # R3 on top: the tsconfig's package in the createElement and classic-import spots
        for package in ("tsrc",):
            if with_package(text, package) == out:
                return (why + " + " if why else "") + "R3 createElement and the classic import follow the tsconfig's jsxImportSource"
    return None

def one_line(s): return s.replace("\n", " ")[:260]

missing = [k for k in main if k not in pr]
extra = [k for k in pr if k not in main]
same = 0
moved_ok = collections.Counter()
bad = []
unmoved = []
for k, v in main.items():
    if k not in pr: continue
    base, expect_key = main, k
    if stage == "b" and is_main_matrix(k):
        expect_key = twin_of(k)
    expected = base.get(expect_key)
    if pr[k] == expected:
        if expect_key != k or (real_main is not main and real_main.get(k) != pr[k]):
            if real_main.get(k) != pr[k]: moved_ok["B a tsconfig.json does not decide what the user states"] += 1
            else: same += 1
        else:
            same += 1
        continue
    why = allowed(expect_key, pr[k], base)
    if why:
        if expect_key != k or real_main is not main: why = "B + " + why
        moved_ok[why] += 1
    else:
        if pr[k] == real_main.get(k) and expected != pr[k]: unmoved.append(k)
        else: bad.append(k)

print(f"cells: {len(main)} on main, {len(pr)} on this build; equal to main {same}")
for why, n in sorted(moved_ok.items()): print(f"  moved, allowed: {n:5d}  {why}")
if missing: print(f"  MISSING in this build: {len(missing)} (e.g. {missing[:3]})")
if extra: print(f"  extra in this build: {len(extra)}")
print(f"  moved, NOT allowed: {len(bad)}")
if stage == "b": print(f"  equal to main where the rule asks for another output: {len(unmoved)}")
by_entry = collections.Counter(k.split("|")[-1] for k in bad)
if bad: print("  by entry:", dict(by_entry))
def expected_of(k):
    return main.get(twin_of(k) if (stage == "b" and is_main_matrix(k)) else k, "?")
for k in bad[:show]:
    print(f"--- {k}\n    main:     {one_line(real_main.get(k, '?'))}\n    expected: {one_line(expected_of(k))}\n    this:     {one_line(pr[k])}")
if len(bad) > show: print(f"... and {len(bad) - show} more (use --show=N)")
for k in unmoved[:show]:
    print(f"--- unmoved {k}\n    main and this: {one_line(pr[k])}\n    expected:      {one_line(expected_of(k))}")
sys.exit(1 if (bad or missing or unmoved) else 0)
