// The corpus of targeted/09-checker-grammar.txt alone (tsc parses, its checker reports a grammar error, the base rejects), and its oracle records.
//   node mk09.cjs <09-checker-grammar.txt> <extended oracle.targeted.jsonl.gz> <corpus.targeted09.json> <oracle.targeted09.jsonl.gz>
const fs = require("fs");
const zlib = require("zlib");
const [txt, oraclePath, corpusOut, oracleOut] = process.argv.slice(2);
const sources = fs.readFileSync(txt, "utf8").split("\n").filter(l => l.length > 0 && !l.startsWith("# ")).map(l => l.replaceAll("\u23ce", "\n"));
const bySrc = new Map(zlib.gunzipSync(fs.readFileSync(oraclePath)).toString("utf8").split("\n").filter(Boolean).slice(1).map(l => [JSON.parse(l).src, l]));
const lines = [JSON.stringify({ header: 1, version: "6.0.2", revision: "tsc", corpus: "targeted09", count: sources.length, apis: [] })];
for (const src of sources) {
  const line = bySrc.get(src);
  if (!line) throw new Error("no oracle record for " + JSON.stringify(src));
  lines.push(line);
}
fs.writeFileSync(corpusOut, JSON.stringify({ name: "targeted09", contexts: {}, forms: [], sources: sources.map(src => ({ prod: "09-checker-grammar", src })) }));
fs.writeFileSync(oracleOut, zlib.gzipSync(lines.join("\n") + "\n"));
console.log(corpusOut, sources.length, "sources");
