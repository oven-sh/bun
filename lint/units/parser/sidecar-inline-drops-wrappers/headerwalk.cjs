// Checks the header walk: the modifier keywords and `*` of a class member are the tokens found by walking
// backwards from the name token (`[` of a computed name) to the start of the member, stopping at a word that
// is no member keyword or that follows `@` or `.` (the last name of a decorator).
// Compared with tsc: modifiers (decorators left out), the `*` of a generator, `get` / `set` of an accessor.
// usage: node headerwalk.cjs --dir <directory>... | node headerwalk.cjs --src '<source>'...
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const fs = require("fs"), path = require("path");
const K = ts.SyntaxKind;
const WORDS = new Set(["abstract", "accessor", "async", "declare", "get", "override", "private", "protected", "public", "readonly", "set", "static"]);
const isWs = c => c === 9 || c === 10 || c === 11 || c === 12 || c === 13 || c === 32 || c === 0xa0 || c === 0xfeff || c === 0x2028 || c === 0x2029;
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
function run(src, file) {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true, kind);
  if (sf.parseDiagnostics.length) return { skip: true };
  const endAt = new Map(commentRanges(src, sf).map(c => [c[1], c[0]]));
  const prevEnd = pos => { for (;;) { if (pos > 0 && isWs(src.charCodeAt(pos - 1))) pos--; else if (endAt.has(pos)) pos = endAt.get(pos); else return pos; } };
  const isWord = c => (c >= 97 && c <= 122) || (c >= 65 && c <= 90);
  const isPart = c => isWord(c) || (c >= 48 && c <= 57) || c === 95 || c === 36 || c === 92 || c > 127;
  function walk(floor, anchor) {
    const out = [];
    let cur = anchor;
    for (;;) {
      const e = prevEnd(cur);
      if (e <= floor) break;
      if (src[e - 1] === "*") { out.push("*:" + (e - 1) + ":" + e); cur = e - 1; continue; }
      let s = e;
      while (s > floor && isWord(src.charCodeAt(s - 1))) s--;
      if (s === e || (s > 0 && isPart(src.charCodeAt(s - 1)))) break;
      const w = src.slice(s, e);
      if (!WORDS.has(w)) break;
      const t = prevEnd(s);
      if (t > 0 && (src[t - 1] === "@" || src[t - 1] === ".")) break;
      out.push(w + ":" + s + ":" + e);
      cur = s;
    }
    return out.reverse();
  }
  const fails = [];
  let members = 0, tokens = 0;
  (function visit(n) {
    ts.forEachChild(n, visit);
    if (!n.parent || !(ts.isClassLike(n.parent)) || !n.parent.members.includes(n)) return;
    if (n.kind === K.SemicolonClassElement) return;
    members++;
    const expected = [];
    for (const m of n.modifiers || []) if (m.kind !== K.Decorator) expected.push(ts.tokenToString(m.kind) + ":" + m.getStart(sf) + ":" + m.end);
    let anchor;
    if (n.kind === K.ClassStaticBlockDeclaration) {
      // the `static` of a static block is its own token: the walk starts at `{`
      anchor = n.body.getStart(sf);
      const st = n.getChildren(sf).find(c => c.kind === K.StaticKeyword);
      expected.push("static:" + st.getStart(sf) + ":" + st.end);
    } else if (n.kind === K.Constructor) {
      anchor = n.getChildren(sf).find(c => c.kind === K.ConstructorKeyword || c.kind === K.StringLiteral).getStart(sf);
    } else if (n.kind === K.IndexSignature) {
      anchor = n.getChildren(sf).find(c => c.kind === K.OpenBracketToken).getStart(sf);
    } else {
      anchor = n.name.getStart(sf);
      if (n.asteriskToken) expected.push("*:" + n.asteriskToken.getStart(sf) + ":" + n.asteriskToken.end);
      if (n.kind === K.GetAccessor || n.kind === K.SetAccessor) {
        const kw = n.getChildren(sf).find(c => c.kind === K.GetKeyword || c.kind === K.SetKeyword);
        expected.push(ts.tokenToString(kw.kind) + ":" + kw.getStart(sf) + ":" + kw.end);
      }
    }
    expected.sort((a, b) => Number(a.split(":")[1]) - Number(b.split(":")[1]));
    const got = walk(n.getStart(sf), anchor);
    tokens += got.length;
    if (JSON.stringify(expected) !== JSON.stringify(got)) fails.push({ at: n.getStart(sf), expected, got });
  })(sf);
  return { fails, members, tokens };
}
const args = process.argv.slice(2);
let files = 0, bad = 0, members = 0, tokens = 0, skipped = 0;
const one = (src, file, label) => {
  let r; try { r = run(src, file); } catch (e) { r = { fails: [{ error: String(e.message) }], members: 0, tokens: 0 }; }
  if (r.skip) { skipped++; return; }
  files++; members += r.members; tokens += r.tokens;
  if (r.fails.length) { bad++; if (bad <= 15) console.log("FAIL " + label + " " + JSON.stringify(r.fails.slice(0, 2))); }
  else if (args[0] === "--src") console.log("PASS " + label);
};
if (args[0] === "--src") for (const s of args.slice(1)) one(s, "t.ts", JSON.stringify(s));
else {
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
}
console.log(`files ${files} with a difference ${bad} skipped ${skipped}; class members ${members}, header tokens ${tokens}`);
