// Builds expected.json, the test inputs with their tsc 6.0.2 expectations, from inputs.json, oracle.jsonl (tsc) and
// bun.jsonl (base build e3566be889). Optional third argument: a jsonl of a changed build (bunprobe.mjs), to compare.
// usage: node expected.cjs [changed.jsonl] > expected.json ; a summary goes to stderr
const fs = require("fs");
const dir = __dirname;
const inputs = JSON.parse(fs.readFileSync(dir + "/inputs.json", "utf8"));
const load = f => new Map(fs.readFileSync(f, "utf8").trim().split("\n").map(l => JSON.parse(l)).map(r => [r.id, r]));
const tsc = load(dir + "/oracle.jsonl"), base = load(dir + "/bun.jsonl");
const changed = process.argv[2] ? load(process.argv[2]) : null;
// Inputs that tsc parses and that a parse WITHOUT lint keeps rejecting, with the reason. Everything else that tsc
// parses and the base build rejects is expected to parse in every mode.
const residue = {
  speculation: ["B35", "B36", "B37", "G17", "G18"],
  "early error of Bun's expression or statement parser": ["F10", "F18", "F23", "F24", "F30"],
  "not an expression site (modifiers, private names, import type argument, JSDoc forms)": ["D5", "D6", "D8", "D23", "D24", "D25", "D26", "D27", "D28", "D29", "D30", "D31", "G46", "F36", "C33", "H12", "H27", "H28", "G42"],
  "initializer of a property without a type": ["E4"],
};
const why = new Map();
for (const [reason, ids] of Object.entries(residue)) for (const id of ids) why.set(id, reason);
const norm = s => s.replace(/^"use strict";\n/, "").replace(/\s+/g, " ").trim();
const out = [];
const count = {};
for (const input of inputs) {
  if (input.site === "K") continue;
  const t = tsc.get(input.id), b = base.get(input.id);
  const tscParses = t.parse.length === 0, baseAccepts = b.err === undefined;
  let without_lint;
  if (baseAccepts) without_lint = "accept, output unchanged";
  else if (!tscParses) without_lint = "reject";
  else without_lint = why.has(input.id) ? "reject (" + why.get(input.id) + ")" : "accept";
  const rec = {
    id: input.id, site: input.site, text: input.text, tsx: !!input.tsx, decorator_metadata: !!input.deco,
    tsc: { parses: tscParses, parse: t.parse.map(p => p.split(" ")[0]), grammar: t.gram, semantic: t.sem, emit: norm(t.emit) },
    base: baseAccepts ? { accepts: true, out: norm(b.out) } : { accepts: false, error: b.err },
    without_lint, lint: tscParses ? "parses" : "rejects",
  };
  if (changed) {
    const c = changed.get(input.id);
    rec.prototype = c.err === undefined ? { accepts: true, out: norm(c.out) } : { accepts: false, error: c.err };
    const k = (baseAccepts ? "accept" : "reject") + " -> " + (c.err === undefined ? "accept" : "reject") + (tscParses ? " (tsc parses)" : " (tsc rejects)");
    count[k] = (count[k] || 0) + 1;
    if (baseAccepts && c.err === undefined && norm(b.out) !== norm(c.out)) count["OUTPUT CHANGED " + input.id] = 1;
    if (!baseAccepts && c.err !== undefined && b.err !== c.err) count["first error changed"] = (count["first error changed"] || 0) + 1;
    const expectAccept = without_lint.startsWith("accept");
    if (expectAccept !== (c.err === undefined)) (count.mismatch ||= []).push(input.id + (c.err ? ": " + c.err : ": accepted"));
  }
  out.push(rec);
}
process.stdout.write(JSON.stringify(out, null, 1));
console.error(JSON.stringify(count, null, 1));
