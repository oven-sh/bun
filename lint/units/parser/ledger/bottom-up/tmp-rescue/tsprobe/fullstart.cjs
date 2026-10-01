// Checks: for every node inside type syntax, tsc's pos == full_start(first token start), with comments from the scanner.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("fs");
const path = require("path");

function isSpace(cp) {
  return cp === 0x09 || cp === 0x0a || cp === 0x0b || cp === 0x0c || cp === 0x0d || cp === 0x2028 || cp === 0x2029 || cp === 0xfeff ||
    cp === 0x20 || cp === 0xa0 || cp === 0x1680 || (cp >= 0x2000 && cp <= 0x200a) || cp === 0x202f || cp === 0x205f || cp === 0x3000;
}
function collectComments(text, sf) {
  // every comment of the file: the trivia before and after each token
  const out = [];
  const seen = new Set();
  function add(r) { if (r) for (const c of r) if (!seen.has(c.pos)) { seen.add(c.pos); out.push([c.pos, c.end]); } }
  function visit(n) {
    const kids = n.getChildren(sf);
    if (kids.length === 0 || n.kind < ts.SyntaxKind.FirstNode) {
      add(ts.getLeadingCommentRanges(text, n.pos));
      add(ts.getTrailingCommentRanges(text, n.end));
      add(ts.getLeadingCommentRanges(text, n.end));
    }
    for (const k of kids) visit(k);
  }
  visit(sf);
  out.sort((a, b) => a[0] - b[0]);
  return out;
}
function fullStart(text, comments, start) {
  let pos = start;
  // comments[0..count) end at or before pos
  let lo = 0, hi = comments.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (comments[mid][1] <= pos) lo = mid + 1; else hi = mid; }
  let count = lo;
  for (;;) {
    const floor = count > 0 ? comments[count - 1][1] : 0;
    while (pos > floor && isSpace(text.charCodeAt(pos - 1))) pos--;
    if (count === 0 || pos !== floor) break;
    count--;
    pos = comments[count][0];
  }
  const before = text.slice(0, pos);
  if (before.startsWith("#!") && !/[\r\n]/.test(before)) return 0;
  return pos;
}
const K = ts.SyntaxKind;
function inTypeSyntax(n) {
  for (let p = n; p; p = p.parent) {
    if (p.kind >= K.FirstTypeNode && p.kind <= K.LastTypeNode) return true;
    if (p.kind === K.TypeParameter || p.kind === K.HeritageClause || p.kind === K.InterfaceDeclaration || p.kind === K.TypeAliasDeclaration) return true;
    if (ts.isTypeNode(p)) return true;
    if (ts.isStatement(p) || ts.isSourceFile(p)) return false;
  }
  return false;
}
let files = 0, nodes = 0, lists = 0, bad = 0, skipped = 0;
const examples = [];
function checkFile(file) {
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return; }
  if (text.length > 300000) return;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  if (sf.parseDiagnostics.length) { skipped++; return; }
  files++;
  const comments = collectComments(text, sf);
  function visit(n) {
    if (n.kind !== K.SourceFile && n.kind !== K.EndOfFileToken && inTypeSyntax(n) && n.kind < K.FirstJSDocNode) {
      if (n.end > n.pos) {
        nodes++;
        const start = n.getStart(sf, false);
        const fsPos = fullStart(text, comments, start);
        if (fsPos !== n.pos) { bad++; if (examples.length < 15) examples.push([file, K[n.kind], n.pos, start, fsPos, JSON.stringify(text.slice(Math.max(0, n.pos - 10), start + 10))]); }
      }
      for (const k of Object.keys(n)) {
        const v = n[k];
        if (Array.isArray(v) && typeof v.pos === "number" && k !== "jsDoc" && v.pos >= 0) {
          lists++;
          // the list starts at the end of its opening token, or at the first token of its first item
          if (v.length > 0 && v[0].end > v[0].pos) {
            const first = v[0].getStart(sf, false);
            const viaFirst = fullStart(text, comments, first);
            // a union or intersection with a leading operator starts before its first item
            if (viaFirst !== v.pos && !(n.kind === K.UnionType || n.kind === K.IntersectionType)) { bad++; if (examples.length < 15) examples.push([file, "LIST " + k + " of " + K[n.kind], v.pos, first, viaFirst]); }
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  }
  visit(sf);
}
function walkDir(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(p, out);
    else if (/\.(ts|tsx|mts|cts)$/.test(e.name)) out.push(p);
  }
}
const roots = process.argv.slice(2);
const all = [];
for (const r of roots) walkDir(r, all);
let crashed = 0;
for (const f of all) { try { checkFile(f); } catch (e) { crashed++; } }
console.log('crashed', crashed);
console.log(JSON.stringify({ files, skipped, nodes, lists, bad }));
for (const e of examples) console.log(e.join(" | "));
