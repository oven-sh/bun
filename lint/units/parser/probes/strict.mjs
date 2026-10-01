// Data for the strict grammar of a lint parse.
//
// usage: bun strict.mjs
// Writes
//   out/strict-grammar.B.tsv    every input that Bun accepts and the parser of tsc rejects:
//                               dialect, group, family, input, code, start, length, message (first parse diagnostic),
//                               count of parse diagnostics
//   out/strict-grammar.A2.tsv   every input that tsc parses and whose checker reports a grammar code, with the
//                               verdict of Bun: dialect, group, family, input, bun (accepts or first message),
//                               code, start, length, message (one line per diagnostic)
// start and length are offsets into the input, as tsc reports them (UTF-16 units; the inputs are ASCII).

import { readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { effective, readRecords } from "./report.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(join(HERE, "inputs"))
  .filter(f => f.endsWith(".mjs") && !f.startsWith("_") && !f.startsWith("00") && !f.startsWith("11"))
  .sort();

const b = ["dialect\tgroup\tfamily\tinput\tcode\tstart\tlength\tmessage\tdiagnostics"];
const a2 = ["dialect\tgroup\tfamily\tinput\tbun\tcode\tstart\tlength\tmessage"];
const counts = {};
for (const file of files) {
  const base = file.replace(/\.mjs$/, "");
  const mod = await import(join(HERE, "inputs", file));
  const dialects = ["ts", ...(mod.default.programs ?? []).filter(d => d !== "ts")];
  const recs = readRecords(base);
  for (const dialect of dialects) {
    const seenB = new Set();
    for (const e of effective(recs, dialect)) {
      if (e.cls === "B") {
        // The tsx and dts lines repeat the ts line unless the diagnostic differs.
        const d = e.parse[0];
        const line = [base, e.r.fam, JSON.stringify(e.r.src), d[0], d[1], d[2], JSON.stringify(d[3]), e.parse.length].join("\t");
        if (dialect !== "ts" && e.r.tsc[dialect].parse === "=" && e.r.cls.ts === "B") continue;
        if (seenB.has(line)) continue;
        seenB.add(line);
        b.push(dialect + "\t" + line);
        counts["B." + dialect] = (counts["B." + dialect] ?? 0) + 1;
      } else if (e.cls === "A2" || e.cls === "AAg") {
        const bun = e.bun === 1 ? "accepts" : JSON.stringify(e.bun[0][0]);
        for (const d of e.grammar) {
          a2.push([dialect, base, e.r.fam, JSON.stringify(e.r.src), bun, d[0], d[1], d[2], JSON.stringify(d[3])].join("\t"));
        }
        counts[e.cls + "." + dialect] = (counts[e.cls + "." + dialect] ?? 0) + 1;
      }
    }
  }
}
writeFileSync(join(HERE, "out", "strict-grammar.B.tsv"), b.join("\n") + "\n");
writeFileSync(join(HERE, "out", "strict-grammar.A2.tsv"), a2.join("\n") + "\n");
console.log(counts);

// The codes that the parser of tsc gives to inputs that Bun accepts, by count.
const byCode = new Map();
for (const line of b.slice(1)) {
  const f = line.split("\t");
  const k = `TS${f[4]} ${f[7]}`;
  byCode.set(k, (byCode.get(k) ?? 0) + 1);
}
const top = [...byCode].sort((x, y) => y[1] - x[1]);
writeFileSync(join(HERE, "out", "strict-grammar.B.codes.txt"), top.map(([k, n]) => `${n}\t${k}`).join("\n") + "\n");
console.log(top.slice(0, 40).map(([k, n]) => `${n} ${k}`).join("\n"));
