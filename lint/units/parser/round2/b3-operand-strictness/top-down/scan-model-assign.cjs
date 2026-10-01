// The model of scan-model.cjs for the assignment rows: from where the left operand starts, the first assignment
// operator outside brackets is the token that the reference reports. The left operand is taken from tsc's tree: the
// widest expression that ends where the token before the diagnostic ends and is no assignment. usage: node scan-model-assign.cjs
const ts = require("/workspace/wt/parser/node_modules/typescript");
const fs = require("node:fs");
const K = ts.SyntaxKind;
const kinds = { Ts: ts.ScriptKind.TS, Tsx: ts.ScriptKind.TSX, Js: ts.ScriptKind.JS, Jsx: ts.ScriptKind.JSX };
const rows = [];
let group = "";
for (const line of fs.readFileSync("test-rows.txt", "utf8").split("\n")) {
  if (line.startsWith("// ")) { group = line.slice(3); continue; }
  const m = /^\s*\(b"((?:[^"\\]|\\.)*)", Loader::(\w+), (\d+), (\d+), (\d+), /.exec(line);
  if (!m) continue;
  const text = Buffer.from(JSON.parse('"' + m[1].replace(/\\x([0-9a-f]{2})/g, (_, h) => "\\u00" + h) + '"'), "latin1").toString("utf8");
  rows.push({ group, text, loader: m[2], code: +m[3], start: +m[4], end: +m[5] });
}
const endsExpression = k => k === K.Identifier || k === K.PrivateIdentifier || k === K.NumericLiteral || k === K.BigIntLiteral || k === K.StringLiteral || k === K.NoSubstitutionTemplateLiteral || k === K.TemplateTail || k === K.RegularExpressionLiteral || k === K.CloseParenToken || k === K.CloseBracketToken || k === K.CloseBraceToken || k === K.ThisKeyword || k === K.SuperKeyword || k === K.NullKeyword || k === K.TrueKeyword || k === K.FalseKeyword || k === K.PlusPlusToken || k === K.MinusMinusToken;
const isAssign = k => k >= K.FirstAssignment && k <= K.LastAssignment;
function scan(text, from, jsx) {
  const s = ts.createScanner(ts.ScriptTarget.Latest, true, jsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, text);
  s.resetTokenState(from);
  const stack = [];
  let prev = K.Unknown;
  for (;;) {
    let k = s.scan();
    if (k === K.EndOfFileToken) return null;
    if (k === K.GreaterThanToken) k = s.reScanGreaterToken();
    if ((k === K.SlashToken || k === K.SlashEqualsToken) && !endsExpression(prev)) k = s.reScanSlashToken();
    if (k === K.LessThanToken && jsx && !endsExpression(prev)) return null;
    if (k === K.OpenParenToken || k === K.OpenBracketToken || k === K.OpenBraceToken) stack.push(false);
    else if (k === K.TemplateHead) stack.push(true);
    else if (k === K.CloseParenToken || k === K.CloseBracketToken) { if (!stack.length) return null; stack.pop(); }
    else if (k === K.CloseBraceToken) {
      if (!stack.length) return null;
      if (stack[stack.length - 1]) { k = s.reScanTemplateToken(false); if (k === K.TemplateTail) stack.pop(); }
      else stack.pop();
    } else if (isAssign(k) && !stack.length) return { at: [s.getTokenStart(), s.getTokenEnd()], newline: s.hasPrecedingLineBreak() };
    prev = k;
  }
}
// tsc closes a bracket that the source leaves open where it recovers: such a node is no left operand of Bun's tree.
const balanced = t => { let d = 0; for (const c of t.replace(/\/\*[^]*?\*\/|\/\/[^\n]*/g, "")) { if ("([{".includes(c)) d++; else if (")]}".includes(c)) d--; if (d < 0) return false; } return d === 0; };
let checked = 0, failed = 0, skipped = 0;
for (const r of rows) {
  if (!r.group.startsWith("assignment") && r.group !== "type-assertion") continue;
  const sf = ts.createSourceFile("x." + r.loader.toLowerCase(), r.text, ts.ScriptTarget.Latest, true, kinds[r.loader]);
  const toUnits = b => Buffer.from(r.text, "utf8").subarray(0, b).toString("utf8").length;
  const at = toUnits(r.start);
  const want = [at, toUnits(r.end)];
  if (!/^(=|\+=|-=|\*=|\/=|%=|\*\*=|<<=|>>=|>>>=|&=|\|=|\^=|&&=|\|\|=|\?\?=)$/.test(r.text.slice(want[0], want[1]))) { skipped++; continue; }
  let best = null;
  const isExpression = n => n.kind >= K.ArrayLiteralExpression && n.kind <= K.SatisfiesExpression || n.kind === K.Identifier || n.kind === K.JsxElement || n.kind === K.JsxSelfClosingElement;
  const visit = n => {
    const assignment = n.kind === K.BinaryExpression && isAssign(n.operatorToken.kind);
    if (isExpression(n) && !assignment && balanced(r.text.slice(n.getStart(sf), at)) && n.end <= at && r.text.slice(n.end, at).replace(/\/\*[^]*?\*\/|\/\/[^\n]*/g, "").trim() === "" && (!best || n.getStart(sf) < best.getStart(sf))) best = n;
    ts.forEachChild(n, visit);
  };
  visit(sf);
  if (!best) { skipped++; console.log("SKIPPED", JSON.stringify(r.text)); continue; }
  const found = scan(r.text, best.getStart(sf), r.loader === "Tsx" || r.loader === "Jsx");
  checked++;
  const wantNewline = r.code === 1128 || r.code === 1129 || r.code === 1068 || /\n\s*=/.test(r.text) || /\n \*\/ =/.test(r.text) || /\/\/ c\n=/.test(r.text) || /\n\+=/.test(r.text);
  if (!found || found.at[0] !== want[0] || found.at[1] !== want[1]) { failed++; console.log("MISMATCH", JSON.stringify(r.text), "want", want, "found", JSON.stringify(found), "from", best.getStart(sf)); }
}
console.log(`${checked} rows checked, ${failed} mismatches, ${skipped} rows skipped (the token is no assignment operator)`);
