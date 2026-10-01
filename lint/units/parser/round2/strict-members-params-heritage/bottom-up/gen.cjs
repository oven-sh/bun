// usage: node gen.cjs <out.jsonl>
// Every seed of seeds.cjs with one token deleted, doubled, swapped with the next, replaced by a word of the
// vocabulary, or with such a word put before it. One line for each distinct text:
// {i, g: group, s: source, m: mutation, t: null | [code, start, length] (first parse diagnostic of tsc 6.0.2)}.
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const fs = require("node:fs");
const seeds = require("./seeds.cjs");
const VOCAB = [";", ",", "?", "!", ":", "=", "*", "...", "@d", "(", ")", "{", "}", "[", "]", "<", ">", "=>", ".", "public", "private", "protected", "readonly", "static", "abstract", "declare", "override", "accessor", "async", "get", "set", "export", "default", "const", "in", "out", "this", "x", "1", "'s'", "#p", "constructor", "extends", "implements", "new", "class", "function", "var", "let", "await", "yield", "super", "null", "void", "\n", "<T>", "()", "{}", "= 1", ": T"];
function tokens(src) {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, src);
  const out = [];
  for (;;) {
    const kind = scanner.scan();
    if (kind === ts.SyntaxKind.EndOfFileToken) break;
    out.push([scanner.getTokenStart(), scanner.getTokenEnd()]);
  }
  return out;
}
const first = src => {
  const sf = ts.createSourceFile("input.ts", src, ts.ScriptTarget.Latest, false, ts.ScriptKind.TS);
  const d = sf.parseDiagnostics[0];
  return d ? [d.code, d.start, d.length] : null;
};
const seen = new Set();
const out = fs.createWriteStream(process.argv[2]);
let i = 0;
const emit = (g, s, m) => {
  if (seen.has(s)) return;
  seen.add(s);
  out.write(JSON.stringify({ i: i++, g, s, m, t: first(s) }) + "\n");
};
for (const [g, seed] of seeds) {
  if (first(seed)) throw new Error("seed has a parse diagnostic: " + seed);
  emit(g, seed, "seed");
  const toks = tokens(seed);
  for (let k = 0; k < toks.length; k++) {
    const [a, b] = toks[k];
    const word = seed.slice(a, b);
    emit(g, seed.slice(0, a) + seed.slice(b), "del " + word);
    emit(g, seed.slice(0, b) + " " + word + seed.slice(b), "dup " + word);
    if (k + 1 < toks.length) {
      const [c, d] = toks[k + 1];
      emit(g, seed.slice(0, a) + seed.slice(c, d) + seed.slice(b, c) + word + seed.slice(d), "swap " + word + " " + seed.slice(c, d));
    }
    for (const v of VOCAB) {
      emit(g, seed.slice(0, a) + v + " " + seed.slice(a), "ins " + JSON.stringify(v) + " before " + word);
      emit(g, seed.slice(0, a) + v + seed.slice(b), "rep " + word + " by " + JSON.stringify(v));
    }
  }
}
out.end(() => console.error(i + " inputs"));
