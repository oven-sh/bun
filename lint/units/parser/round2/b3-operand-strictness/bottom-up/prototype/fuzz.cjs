// usage: node fuzz.cjs <plain probe> <prototype probe> [ts|js|tsx]
// Expression snippets: a left part, a continuation (on the same line and after a line break), in several places of a statement.
// For each: typescript-go (first diagnostic), the lint parse of the head and the lint parse with the prototype.
// Prints the classes, and every source where the prototype and typescript-go disagree on taking it, or where both reject with another first diagnostic and the head took it.
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const [plain, proto, loader = "ts"] = process.argv.slice(2);
const ts = loader !== "js";
const lefts = ["a", "(a)", "a.b", "a[0]", "f()", "new A", "new A()", "this", "1", "'s'", "`t`", "/r/", "[a]", "({a})", "(function(){})", "class {}",
  "a++", "a--", "++a", "--a", "-a", "+a", "!a", "~a", "typeof a", "void a", "delete a.b", "a + b", "a, b", "a ? b : c", "a = b", "a?.b", "a?.()", "t`x`", "a ?? b", "a in b",
  "function(){}", "(a, b)", "(a + b)", "(a++)", "(-a)", "import.meta",
  ...(ts ? ["a!", "a as T", "<T>a", "a satisfies T", "(a as T)", "(<T>a)", "a<T>", "a!!", "(a)!", "a++ as T"] : []),
  ...(loader === "tsx" ? ["<x/>", "<x></x>", "(<x/>)"] : [])];
const conts = [" = c", " += c", " ??= c", "++", "--", ".b", "?.b", "[0]", "(b)", "()", "`x`", "`x${1}`", " ++", " --", " in c", " instanceof c", " + c", " ** c", " ? b : c", ", c", " < c", " << c",
  ...(ts ? ["!", " as T", "<T>(b)", "<T>"] : [])];
const prefixes = ["", "++", "--", "-", "typeof ", "await "];
const places = [s => `${s};`, s => `(${s});`, s => `f(${s});`, s => `let x = ${s};`, s => `x = ${s};`, s => `[${s}];`, s => `x = y ? ${s} : z;`];
const rows = [];
for (const left of lefts) for (const cont of conts) for (const nl of ["", "\n"]) for (const prefix of prefixes) {
  if (prefix && nl) continue;
  for (let k = 0; k < places.length; k++) {
    if (prefix && k > 1) continue;
    if (nl && k > 3) continue;
    const inner = `${prefix}${left}${nl}${cont.replace(/^ /, nl ? "" : " ")}`;
    const code = prefix === "await " ? `async function g() { ${places[k](inner)} }` : places[k](inner);
    rows.push({ id: rows.length, code });
  }
}
const p = spawnSync("/tmp/rr/parsediag", ["-max", "1"], { input: rows.map(r => JSON.stringify({ id: r.id, name: "input." + loader, text: r.code })).join("\n") + "\n", maxBuffer: 1 << 28 });
const go = new Map();
for (const line of String(p.stdout).split("\n")) { if (!line) continue; const r = JSON.parse(line); go.set(r.id, r.d?.[0] ?? null); }
fs.writeFileSync("/tmp/b3/fuzz/in.hex", rows.map(r => `${r.id} ${loader} ${Buffer.from(r.code, "utf8").toString("hex")}`).join("\n") + "\n");
function run(bin, tag) {
  const r = spawnSync(bin, ["zz_probe"], { env: { ...process.env, SMPH_INPUTS: "/tmp/b3/fuzz/in.hex", SMPH_OUT: `/tmp/b3/fuzz/${tag}.tsv` }, maxBuffer: 1 << 26 });
  if (r.status !== 0) { console.error(tag, "status", r.status); process.exit(1); }
  const out = new Map();
  for (const line of fs.readFileSync(`/tmp/b3/fuzz/${tag}.tsv`, "utf8").split("\n")) { if (!line) continue; const f = line.split("\t"); out.set(Number(f[0]), f.slice(1)); }
  return out;
}
const a = run(plain, "plain"), b = run(proto, "proto");
const unhex = h => Buffer.from(h ?? "", "hex").toString();
const entry = f => f[0] === "ok" ? null : f[0] === "panic" ? "PANIC" : [Number(f[3]), Number(f[4]), Number(f[5]) - Number(f[4]), unhex(f[8])];
const show = x => x === null ? "parses" : x === "PANIC" ? "PANIC" : `TS${x[0]} @${x[1]}+${x[2]} ${JSON.stringify(x[3].slice(0, 40))}`;
const counts = {};
const lines = [];
for (const r of rows) {
  const d = go.get(r.id) ?? null, x = entry(a.get(r.id)), y = entry(b.get(r.id));
  const changed = JSON.stringify(x) !== JSON.stringify(y);
  let cls;
  if (y === "PANIC") cls = "PANIC";
  else if (!d && !y) cls = "ok";
  else if (d && !y) cls = "MISSED";
  else if (!d && y) cls = changed ? "EXTRA(new)" : "EXTRA(head too)";
  else if (JSON.stringify(d) === JSON.stringify(y)) cls = changed ? "same(new)" : "same(head too)";
  else cls = changed ? "DIFF(new)" : "DIFF(head too)";
  counts[cls] = (counts[cls] ?? 0) + 1;
  if (cls === "MISSED" || cls === "EXTRA(new)" || cls === "DIFF(new)" || cls === "PANIC") lines.push(`${cls.padEnd(10)} ${JSON.stringify(r.code)}  go: ${show(d)}  lint: ${show(y)}`);
}
console.log(JSON.stringify({ loader, sources: rows.length, ...counts }));
for (const l of lines) console.log(l);
