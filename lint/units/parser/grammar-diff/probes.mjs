// The probe inputs of round 2 as one corpus: sources that were written at the sites where round 1 and main differ
// (parameter modifiers, parameters of signatures, tuple elements, type members, heritage entries, instantiation
// expressions, reserved words as type names, class members, metadata of conditional types, type parameter lists,
// casts of arrow functions, comments inside regions that are read twice) and that no other corpus holds whole.
//   bun probes.mjs [out, default corpus.probes.json beside this file]
// Read from round2/a1-differential: top-down/probes/*.txt (one source per line, U+23CE is a line break; in
// witness.pairs.txt a line that starts with "# " is a comment and "=> " starts a witness) and
// bottom-up/scripts/p/*.json (lists of sources). `prod` is the file a source comes from first.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const N = join(import.meta.dirname, "..");
const TD = join(N, "round2/a1-differential/top-down/probes");
const BU = join(N, "round2/a1-differential/bottom-up/scripts/p");
const seen = new Set();
const sources = [];
const counts = {};
const add = (prod, src) => {
  if (!src.trim() || seen.has(src)) return;
  seen.add(src);
  sources.push({ src, prod });
  counts[prod] = (counts[prod] ?? 0) + 1;
};
for (const name of readdirSync(TD).filter(n => n.endsWith(".txt")).sort()) {
  for (let line of readFileSync(join(TD, name), "utf8").split("\n")) {
    if (name === "witness.pairs.txt") {
      if (line.startsWith("# ")) continue;
      if (line.startsWith("=> ")) line = line.slice(3);
    }
    add("td." + name.slice(0, -4), line.replaceAll("\u23CE", "\n"));
  }
}
for (const name of readdirSync(BU).filter(n => n.endsWith(".json")).sort()) {
  const walk = value => {
    if (typeof value === "string") add("bu." + name.slice(0, -5), value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(JSON.parse(readFileSync(join(BU, name), "utf8")));
}
const out = process.argv[2] ?? join(import.meta.dirname, "corpus.probes.json");
writeFileSync(out, JSON.stringify({ name: "probes", contexts: {}, forms: [], sources }));
for (const [prod, count] of Object.entries(counts)) console.log(`${String(count).padStart(5)}  ${prod}`);
console.log(`${out}: ${sources.length} sources`);
