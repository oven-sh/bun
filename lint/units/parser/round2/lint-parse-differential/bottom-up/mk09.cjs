// The corpus of targeted/09-checker-grammar.txt alone: tsc parses each source, its checker reports a grammar error, the base rejects.
//   node mk09.cjs <09-checker-grammar.txt> <corpus.targeted09.json>
const fs = require("fs");
const [txt, corpusOut] = process.argv.slice(2);
const sources = fs.readFileSync(txt, "utf8").split("\n").filter(l => l.length > 0 && !l.startsWith("# ")).map(l => l.replaceAll("\u23ce", "\n"));
fs.writeFileSync(corpusOut, JSON.stringify({ name: "targeted09", contexts: {}, forms: [], sources: sources.map(src => ({ prod: "09-checker-grammar", src })) }));
console.log(corpusOut, sources.length, "sources");
