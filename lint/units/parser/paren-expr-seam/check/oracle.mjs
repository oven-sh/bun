// usage: bun oracle.mjs <corpus.json> <records.jsonl of run.mjs with the dump> <plain.jsonl of run.mjs without it>
// Compares, per file that tsc 6.0.2 parses without a diagnostic: the parentheses, the annotations of arrow parameters and
// the arrow return types that the lint twin recorded against the tree of tsc; and the transpiled text with and without records.
import ts from "/workspace/wt/parser/node_modules/typescript/lib/typescript.js";
import { readFileSync } from "node:fs";
const root = "/workspace/wt/parser/";
const files = JSON.parse(readFileSync(process.argv[2], "utf8"));
const lines = f => readFileSync(f, "utf8").trim().split("\n").map(l => JSON.parse(l));
const recs = new Map(lines(process.argv[3]).map(r => [r.path, r]));
const plain = new Map(lines(process.argv[4]).map(r => [r.path, r]));
const tot = { files: 0, skippedTsc: 0, skippedBun: 0, outputSame: 0, outputDiff: 0, parens: 0, parenMiss: 0, parenExtra: 0, parenOpenOff: 0, ann: 0, annMiss: 0, annExtra: 0, ret: 0, retMiss: 0, retExtra: 0, blocks: 0, multiBlock: 0 };
const bad = [];
for (const path of files) {
  const r = recs.get(path), q = plain.get(path);
  if (!r || !q) continue;
  if ((r.sha ?? r.err) === (q.sha ?? q.err)) tot.outputSame++; else { tot.outputDiff++; bad.push(["output", path]); }
  if (r.err) { tot.skippedBun++; continue; }
  const text = readFileSync(root + path, "utf8");
  const sf = ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true, path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length) { tot.skippedTsc++; continue; }
  tot.files++;
  // UTF-16 index to UTF-8 byte offset
  let ascii = true; for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) > 127) { ascii = false; break; }
  let map = null;
  if (!ascii) { map = new Int32Array(text.length + 1); let b = 0; for (let i = 0; i < text.length; i++) { map[i] = b; const c = text.codePointAt(i); if (c > 0xffff) { map[i + 1] = b; i++; b += 4; } else b += c < 0x80 ? 1 : c < 0x800 ? 2 : 3; } map[text.length] = b; }
  const at = i => map ? map[i] : i;
  const parens = new Map(), ann = new Set(), ret = new Set();
  (function walk(n) {
    if (n.kind === ts.SyntaxKind.ParenthesizedExpression) parens.set(at(n.end - 1), at(n.getStart(sf)));
    if (n.kind === ts.SyntaxKind.ArrowFunction) {
      for (const p of n.parameters) if (p.type) ann.add(at(p.name.getStart(sf)) + ":" + at(p.type.getStart(sf)));
      if (n.type) ret.add(at(n.getStart(sf)) + ":" + at(n.type.getStart(sf)));
    }
    ts.forEachChild(n, walk);
  })(sf);
  const blocks = []; for (const l of r.dump) { if (l.startsWith("F ")) blocks.push([]); else blocks[blocks.length - 1]?.push(l); }
  tot.blocks += blocks.length; if (blocks.length !== 1) { tot.multiBlock++; bad.push(["blocks " + blocks.length, path]); continue; }
  const gotP = new Map(), gotA = new Set(), gotR = new Set();
  for (const l of blocks[0]) { const f = l.split(" "); if (f[0] === "P") gotP.set(+f[2], +f[1]); else if (f[0] === "A") gotA.add(f[1] + ":" + f[2]); else if (f[0] === "R") gotR.add(f[1] + ":" + f[2]); }
  tot.parens += parens.size; tot.ann += ann.size; tot.ret += ret.size;
  for (const [close, open] of parens) { if (!gotP.has(close)) { tot.parenMiss++; bad.push(["paren missing " + open + ".." + close, path]); } else if (gotP.get(close) !== open) { tot.parenOpenOff++; if (tot.parenOpenOff < 6) bad.push(["paren open " + gotP.get(close) + " != " + open, path]); } }
  for (const [close] of gotP) if (!parens.has(close)) { tot.parenExtra++; bad.push(["paren extra ..", close, path]); }
  for (const k of ann) if (!gotA.has(k)) { tot.annMiss++; bad.push(["annotation missing " + k, path]); }
  for (const k of gotA) if (!ann.has(k)) { tot.annExtra++; bad.push(["annotation extra " + k, path]); }
  for (const k of ret) if (!gotR.has(k)) { tot.retMiss++; bad.push(["return type missing " + k, path]); }
  for (const k of gotR) if (!ret.has(k)) { tot.retExtra++; bad.push(["return type extra " + k, path]); }
}
console.log(JSON.stringify(tot, null, 1));
for (const b of bad.slice(0, 40)) console.log(b.join("  "));
