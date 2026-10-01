// Checks the backward header walk for: parameters (parameter properties), class declarations/expressions (abstract),
// enums (const), and statement-level modifiers (export, default, declare, abstract, async, const) of declarations.
// usage: node headerwalk2.cjs --dir <directory>...
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const fs = require("fs"), path = require("path");
const K = ts.SyntaxKind;
const isWs = c => c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 32 || c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029;
const isNl = c => c === 10 || c === 13 || c === 0x2028 || c === 0x2029;
function commentRanges(src, sf) {
  const out = [], seen = new Set();
  (function visit(n) {
    for (const r of [...(ts.getLeadingCommentRanges(src, n.pos) || []), ...(ts.getTrailingCommentRanges(src, n.end) || [])]) {
      const k = r.pos + ":" + r.end;
      if (!seen.has(k)) { seen.add(k); out.push([r.pos, r.end]); }
    }
    n.getChildren(sf).forEach(visit);
  })(sf);
  return out;
}
const ALL = new Set(["abstract","accessor","async","const","declare","default","export","override","private","protected","public","readonly","static"]); const PARAM = ALL;
const STMT = ALL;
const KEYWORDS = new Set(["function", "class", "enum", "namespace", "module", "interface", "type", "var", "let", "const", "using", "await", "global"]);
const CONTEXTUAL = new Set(["abstract","accessor","async","declare","override","private","protected","public","readonly","static"]);
function run(src, file, stats) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  if (sf.parseDiagnostics.length) return { skip: true };
  const cs = commentRanges(src, sf);
  const endAt = new Map(cs.map(c => [c[1], c[0]]));
  const prevEnd = pos => { for (;;) { if (pos > 0 && isWs(src.charCodeAt(pos - 1))) pos--; else if (endAt.has(pos)) pos = endAt.get(pos); else return pos; } };
  const nlBetween = (a, b) => { for (let i = a; i < b; i++) if (isNl(src.charCodeAt(i))) return true; return false; };
  const isWord = c => (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
  const isPart = c => isWord(c) || (c >= 48 && c <= 57) || c === 95 || c === 36 || c === 92 || c > 127;
  // words: set of modifier words; star: accept `*`; floor: lower bound
  function walk(floor, anchor, words, star, decos) {
    const out = [];
    let cur = anchor;
    decos = (decos || []).slice().sort((a, b) => a - b);
    const hop = () => { while (decos.length && decos[decos.length - 1] >= cur) decos.pop(); if (!decos.length) return false; cur = decos.pop(); return true; };
    for (;;) {
      const e = prevEnd(cur);
      if (e <= floor) break;
      if (star && src[e - 1] === "*") { out.push("*:" + (e - 1) + ":" + e); cur = e - 1; continue; }
      let s = e;
      while (s > floor && isWord(src.charCodeAt(s - 1))) s--;
      if (s === e || (s > 0 && isPart(src.charCodeAt(s - 1)))) { if (hop()) continue; break; }
      const w = src.slice(s, e);
      if (!words.has(w)) { if (hop()) continue; break; }
      const t = prevEnd(s);
      if (t > 0 && (src[t - 1] === "@" || src[t - 1] === ".")) { if (hop()) continue; break; }
      if (CONTEXTUAL.has(w) && nlBetween(e, cur)) break;
      out.push(w + ":" + s + ":" + e);
      cur = s;
    }
    return out.reverse();
  }
  const fails = [];
  const expectMods = n => (n.modifiers || []).filter(m => m.kind !== K.Decorator).map(m => ts.tokenToString(m.kind) + ":" + m.getStart(sf) + ":" + m.end);
  (function visit(n) {
    ts.forEachChild(n, visit);
    // parameters of functions that have a body or not: modifiers before the name
    if (n.kind === K.Parameter && n.parent.kind !== K.IndexSignature && !ts.isTypeNode(n.parent) && !ts.isTypeElement(n.parent)) {
      stats.params++;
      const expected = expectMods(n);
      const anchor = n.dotDotDotToken ? n.dotDotDotToken.getStart(sf) : n.name.getStart(sf);
      const got = walk(n.parent.parameters.pos - 1, anchor, PARAM, false, (n.modifiers || []).filter(m => m.kind === K.Decorator).map(m => m.getStart(sf)));
      stats.ptokens += got.length;
      if (JSON.stringify(expected) !== JSON.stringify(got)) fails.push({ what: "param", at: n.getStart(sf), expected, got });
    }
    // statements with modifiers: anchor = declaration keyword (found by token scan of children)
    const declKinds = [K.FunctionDeclaration, K.ClassDeclaration, K.EnumDeclaration, K.ModuleDeclaration, K.InterfaceDeclaration, K.TypeAliasDeclaration, K.VariableStatement, K.ClassExpression, K.ImportEqualsDeclaration];
    if (declKinds.includes(n.kind)) {
      stats.stmts++;
      const expected = expectMods(n);
      const mods = n.modifiers || [];
      let lastKw = null; for (const m of mods) if (m.kind !== K.Decorator) lastKw = m;
      // anchor: the first token after the last modifier keyword and after every decorator
      let after = n.getStart(sf);
      for (const m of mods) after = Math.max(after, ts.skipTrivia(src, m.end));
      const anchor = mods.length ? after : n.getStart(sf);
      const got = walk(0, anchor, STMT, false, mods.filter(m => m.kind === K.Decorator).map(m => m.getStart(sf)));
      stats.stokens += got.length;
      if (JSON.stringify(expected) !== JSON.stringify(got)) fails.push({ what: "stmt " + K[n.kind], at: n.getStart(sf), expected, got });
    }
  })(sf);
  return { fails };
}
const args = process.argv.slice(2);
let files = 0, bad = 0, skipped = 0; const stats = { params: 0, ptokens: 0, stmts: 0, stokens: 0 };
const one = (src, file, label) => {
  let r; try { r = run(src, file, stats); } catch (e) { r = { fails: [{ error: String(e.message) }] }; }
  if (r.skip) { skipped++; return; }
  files++;
  if (r.fails.length) { bad++; if (bad <= 12) console.log("FAIL " + label + " " + JSON.stringify(r.fails.slice(0, 2))); }
};
const walkDir = d => {
  let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".git") walkDir(f); continue; }
    if (!/\.(ts|tsx|mts|cts)$/.test(e.name)) continue;
    let src; try { src = fs.readFileSync(f, "utf8"); } catch { continue; }
    if (src.length > 400000) continue;
    one(src, "t" + path.extname(e.name), f);
  }
};
for (const d of args.slice(1)) walkDir(d);
console.log(`files ${files} with a difference ${bad} skipped ${skipped}; ` + JSON.stringify(stats));
