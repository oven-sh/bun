// Writes test vectors: for each file, its bytes, its comments and (token start, tsc pos) pairs, all as UTF-8 byte offsets.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const path = require("path");
const K = ts.SyntaxKind;
function walkDir(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(p, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(e.name)) out.push(p);
  }
}
function inTypeSyntax(n) {
  for (let p = n; p; p = p.parent) {
    if (p.kind >= K.FirstTypeNode && p.kind <= K.LastTypeNode) return true;
    if (p.kind === K.TypeParameter || p.kind === K.HeritageClause || p.kind === K.InterfaceDeclaration || p.kind === K.TypeAliasDeclaration) return true;
    if (ts.isTypeNode(p)) return true;
    if (ts.isStatement(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}
const all = [];
for (const r of process.argv.slice(3)) walkDir(r, all);
const chunks = [];
let files = 0, checks = 0, nonAscii = 0;
for (const file of all) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { continue; }
  if (text.length > 200000 || text.includes("\uFFFD")) continue;
  let sf;
  try { sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true); } catch { continue; }
  if (sf.parseDiagnostics.length) continue;
  // utf16 index -> utf8 byte offset
  const map = new Uint32Array(text.length + 1);
  let b = 0;
  for (let i = 0; i < text.length; i++) {
    map[i] = b;
    const c = text.charCodeAt(i);
    if (c < 0x80) b += 1;
    else if (c < 0x800) b += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) { b += 4; map[i + 1] = b; i++; }
    else b += 3;
  }
  map[text.length] = b;
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length !== b) continue;
  if (bytes.length !== text.length) nonAscii++;
  const comments = [];
  const seen = new Set();
  const add = r => { if (r) for (const c of r) if (!seen.has(c.pos)) { seen.add(c.pos); comments.push([map[c.pos], map[c.end]]); } };
  const pairs = [];
  try {
    (function visit(n) {
      const kids = n.getChildren(sf);
      if (kids.length === 0 || n.kind < K.FirstNode) {
        add(ts.getLeadingCommentRanges(text, n.pos));
        add(ts.getTrailingCommentRanges(text, n.end));
        add(ts.getLeadingCommentRanges(text, n.end));
      }
      for (const k of kids) visit(k);
    })(sf);
    (function visit(n) {
      if (n.kind !== K.SourceFile && n.kind !== K.EndOfFileToken && n.kind < K.FirstJSDocNode && n.end > n.pos && inTypeSyntax(n)) {
        pairs.push([map[n.getStart(sf, false)], map[n.pos]]);
      }
      ts.forEachChild(n, visit);
    })(sf);
  } catch { continue; }
  if (pairs.length === 0) continue;
  comments.sort((x, y) => x[0] - y[0]);
  files++; checks += pairs.length;
  chunks.push(Buffer.from(`FILE ${file}\nSRC ${bytes.length}\n`));
  chunks.push(bytes);
  chunks.push(Buffer.from(`\nCOMMENTS ${comments.length}\n` + comments.map(c => c.join(" ")).join("\n") + (comments.length ? "\n" : "") + `CHECKS ${pairs.length}\n` + pairs.map(c => c.join(" ")).join("\n") + "\n"));
}
fs.writeFileSync(process.argv[2], Buffer.concat(chunks));
console.log(JSON.stringify({ files, checks, nonAscii }));
