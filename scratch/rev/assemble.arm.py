import json, re, subprocess, sys
interim = "--interim" in sys.argv
if interim:
    sys.argv.remove("--interim")
table = subprocess.run(["python3", "/tmp/ab/table.py"] + (["--pick-fallback"] if interim else []), capture_output=True, text=True).stdout.rstrip("\n")
vals = {}
for line in table.split("\n"):
    m = re.match(r"\s*\| (.*?) \| (.*?) \| (.*?) \|$", line)
    if m:
        vals[m.group(1)] = (m.group(2), m.group(3))
def delta(cell):
    m = re.search(r"\(([+-][\d,]+)\)", cell)
    return m.group(1) if m else "?"
llint_class = delta(vals["class instance"][0]).lstrip("+")
llint_plain = delta(vals["plain object `{ x: 1, y: 2 }`"][0]).lstrip("+")
jit_cells = [vals[k][1] for k in ("class instance", "class instance, default options", "null-prototype object", "24 classes and 8 dictionary-mode objects in turn")]
jit_deltas = [int(delta(c).replace(",", "")) for c in jit_cells if delta(c) != "?"]
jit_class = (f"{min(jit_deltas):+d} to {max(jit_deltas):+d}") if jit_deltas else "(pending)"
new_tests, new_tests_n, sr_short, self_review, suites = (sys.argv[1:6] + ["@@"] * 5)[:5]
visible = open("/tmp/rev/visible.arm.md").read()
visible = visible.replace("@@NEW_TESTS@@", new_tests).replace("@@SR_SHORT@@", sr_short).replace("@@LLINT_CLASS@@", llint_class).replace("@@JIT_CLASS@@", jit_class)
notes = open("/tmp/rev/notes.arm.tpl.md").read()
if interim:
    table += "\n\n  The JIT column is from the build before the hook and `node:assert` changes left this PR. `formatRaw` is the same bytecode in both builds."
notes = notes.replace("@@INSTR_TABLE@@", table).replace("@@LLINT_PLAIN@@", llint_plain).replace("@@SELF_REVIEW@@", self_review).replace("@@SUITES@@", suites).replace("@@NEW_TESTS_N@@", new_tests_n)
body = visible + notes
open("/tmp/rev/body.arm.md", "w").write(body)
vis = visible
raw = len(vis.split()); nomark = len([w for w in vis.split() if w not in ("###", "-")])
natural = len([w for w in re.sub(r"`[^`]*`", "CODE", vis).split() if w not in ("###", "-")])
print("visible words: raw", raw, "no markers", nomark, "natural", natural, "| body bytes", len(body.encode()))
print("placeholders left:", sorted(set(re.findall(r"@@\w*@@|@@", body))))
print("dashes:", [c for c in ("\u2014", "\u2013") if c in body])
print("JIT class range:", jit_class, "| LLInt class:", llint_class, "| LLInt plain:", llint_plain)
