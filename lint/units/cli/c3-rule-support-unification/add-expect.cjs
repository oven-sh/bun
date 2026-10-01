// Adds to every vector of vectors/<rule>.json what the probe binary reports: `expect` (null when Bun's parser
// rejects the case), and `differs: true` when that is not what ESLint reports (equal reports merged).
// usage: node add-expect.cjs [/tmp/c3u/probe]      (after make-vectors.cjs; the probe is built by probe/build.py)
"use strict";
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const probe = process.argv[2] || "/tmp/c3u/probe";
const dir = path.join(__dirname, "vectors");
function lineCol(code, byteOffset) {
  const before = Buffer.from(code, "utf8").subarray(0, byteOffset).toString("utf8");
  let line = 1, col = 1;
  for (let i = 0; i < before.length; i++) {
    const ch = before[i];
    if (ch === "\r" && before[i + 1] === "\n") continue;
    if (ch === "\n" || ch === "\r" || ch === "\u2028" || ch === "\u2029") { line++; col = 1; } else col++;
  }
  return [line, col];
}
const lone = s => s.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, "\ufffd");
for (const f of fs.readdirSync(dir).sort()) {
  if (!f.endsWith(".json") || f.endsWith(".eslint-rejects.json")) continue;
  const rule = f.slice(0, -5);
  const vectors = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
  const cases = "/tmp/c3u/expect-cases.txt";
  fs.writeFileSync(cases, vectors.map((v, i) => `${i}\t${v.jsx ? "jsx" : "js"}\t${Buffer.from(v.code, "utf8").toString("hex")}`).join("\n") + "\n");
  const out = execFileSync(probe, ["lint", cases], { env: { ...process.env, ASAN_OPTIONS: "detect_leaks=0" }, maxBuffer: 1 << 28 }).toString();
  const got = new Map();
  for (const line of out.split("\n")) {
    if (!line) continue;
    const p = line.split("\t");
    if (p[1] === "PARSE_ERROR") got.set(+p[0], null);
    else if (p[1] === "OK") got.set(+p[0], []);
    else if (p[2] === rule) got.get(+p[0]).push({ start: +p[3], length: +p[4], message: Buffer.from(p[5], "hex").toString("utf8") });
  }
  let differs = 0, rejected = 0;
  vectors.forEach((v, i) => {
    const mine = got.get(i);
    delete v.differs;
    if (mine === null || mine === undefined) { v.expect = null; rejected++; return; }
    v.expect = mine.map(r => { const [line, column] = lineCol(v.code, r.start); return { line, column, start: r.start, length: r.length, message: r.message }; });
    const a = [...new Set(v.eslint.map(m => `${m.line}:${m.column} ${lone(m.message)}`))].sort();
    const b = v.expect.map(m => `${m.line}:${m.column} ${m.message}`).sort();
    if (JSON.stringify(a) !== JSON.stringify(b)) { v.differs = true; differs++; }
  });
  fs.writeFileSync(path.join(dir, f), JSON.stringify(vectors, null, 1) + "\n");
  console.log(`${rule}: ${vectors.length} vectors, ${rejected} rejected by Bun's parser, ${differs} where the probe and ESLint differ`);
}
