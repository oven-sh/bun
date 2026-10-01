// Adds what the parser of typescript-go says to a join2 file: go = [] or [[code, start, end, text] ...] (byte offsets), and clsGo, the class against typescript-go.
//   node addgo.cjs <join2.jsonl> <go.out.jsonl> <out.jsonl>
const fs = require("fs");
const readline = require("readline");
const [joinPath, goPath, outPath] = process.argv.slice(2);
(async () => {
  const go = new Map();
  for await (const line of readline.createInterface({ input: fs.createReadStream(goPath) })) {
    if (!line) continue;
    const r = JSON.parse(line);
    go.set(r.id, r.panic ? [[0, 0, 0, "panic " + r.panic]] : r.diags.map(d => [d[0], d[1], d[1] + d[2], d[5]]));
  }
  const out = fs.createWriteStream(outPath);
  const n = {};
  const add = k => (n[k] = (n[k] ?? 0) + 1);
  for await (const line of readline.createInterface({ input: fs.createReadStream(joinPath) })) {
    if (!line) continue;
    const r = JSON.parse(line);
    const g = go.get(`${r.i}.${r.d}`);
    if (!g) throw new Error(`no typescript-go record for ${r.i}.${r.d}`);
    r.go = g;
    r.clsGo = g.length === 0 ? (r.lint ? "A" : "AA") : r.lint ? "RR" : "B";
    add(`${r.d} against typescript-go: ${r.clsGo}`);
    const t = r.tsc.length === 0, k = g.length === 0;
    if (t !== k) add(`${r.d} tsc ${t ? "parses" : "rejects"}, typescript-go ${k ? "parses" : "rejects"}`);
    else if (!t) {
      const a = r.tsc[0], b = g[0];
      add(`${r.d} both reject: first diagnostic ${a[0] === b[0] && a[1] === b[1] && a[2] === b[2] ? "equal" : a[0] === b[0] ? "same code, other range" : "other code"}`);
    }
    if (r.cls !== r.clsGo) add(`${r.d} class ${r.cls} against tsc is ${r.clsGo} against typescript-go`);
    out.write(JSON.stringify(r) + "\n");
  }
  out.end(() => { for (const k of Object.keys(n).sort()) console.log(`${String(n[k]).padStart(7)}  ${k}`); });
})();
