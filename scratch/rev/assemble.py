import json, re, subprocess, sys

table = subprocess.run(["python3", "/tmp/ab/table.py"], capture_output=True, text=True).stdout.rstrip("\n")
vals = {}
for line in table.split("\n"):
    m = re.match(r"\s*\| (.*?) \| (.*?) \| (.*?) \|$", line)
    if m:
        vals[m.group(1)] = (m.group(2), m.group(3))
def delta(cell):
    m = re.search(r"\(([+-][\d,]+)\)", cell)
    return m.group(1) if m else "?"
llint_class = delta(vals["class instance"][0]).lstrip("+")
jit_cells = [vals[k][1] for k in ("class instance", "class instance, default options", "null-prototype object", "24 classes and 8 dictionary-mode objects in turn")]
jit_deltas = [int(delta(c).replace(",", "")) for c in jit_cells if delta(c) != "?"]
jit_class = f"+{min(jit_deltas)} to +{max(jit_deltas)}" if jit_deltas else "(pending)"

sr_short = sys.argv[1] if len(sys.argv) > 1 else "@@SR_SHORT@@"
self_review = sys.argv[2] if len(sys.argv) > 2 else "@@SELF_REVIEW@@"
suites = sys.argv[3] if len(sys.argv) > 3 else "@@SUITES@@"

instr_notes = "\n".join([
    "  The interpreter counts repeat to within 11 instructions per call. A JIT cell is the lowest of 3 runs (2 for the plain object, the URL and the asserts): a run in which a function is compiled or the heap is collected inside the window counts thousands more per call, on every build.",
    "- So a value that reaches the arm (a class instance, a null-prototype object) pays the host call. `let href` is in the block for every value that is not an array, Set, Map, typed array or one of their iterators, so a plain object, a function or an Error pays its two bytecodes in the interpreter (+65 instructions per call for the plain object) and nothing that the JIT rows can show.",
])
assert_instr = (
    "Instructions per failing `assert.strictEqual(1, 2)`: "
    + vals["failing `assert.strictEqual(1, 2)`"][0].replace(" / not run / ", " to ")
    + " interpreted, "
    + vals["failing `assert.strictEqual(1, 2)`"][1].replace(" / not run / ", " to ")
    + " with the JIT. The added bytecodes are below what these rows resolve (a failing assert with a diff differs by 2,000 instructions between the two builds in the other direction)."
)

visible = open("/tmp/rev/visible.tpl.md").read()
visible = visible.replace("@@SR_SHORT@@", sr_short).replace("@@LLINT_CLASS@@", llint_class).replace("@@JIT_CLASS@@", jit_class)
notes = open("/tmp/rev/notes.tpl.md").read()
notes = notes.replace("@@INSTR_TABLE@@", table).replace("@@INSTR_NOTES@@", instr_notes).replace("@@ASSERT_INSTR@@", assert_instr)
notes = notes.replace("@@SELF_REVIEW@@", self_review).replace("@@SUITES@@", suites)
body = visible + notes
open("/tmp/rev/body.new.md", "w").write(body)

vis = visible
raw = len(vis.split())
nomark = len([w for w in vis.split() if w not in ("###", "-")])
spans = re.sub(r"`[^`]*`", "CODE", vis)
natural = len([w for w in spans.split() if w not in ("###", "-")])
print("visible words: raw", raw, "no markers", nomark, "natural", natural, "| body bytes", len(body.encode()))
left = sorted(set(re.findall(r"@@\w+@@", body)))
print("placeholders left:", left)
bad = [c for c in ("\u2014", "\u2013") if c in body]
print("dashes:", bad)
