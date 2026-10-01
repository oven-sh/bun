// A model of the token scan of the plan, run over the rows of test-rows.txt whose first diagnostic is at the token
// after a postfix update: from where the operand of the update starts, the first `++` or `--` outside brackets is the
// operator of the update, and the token after it is what the reference reports. The model uses the scanner of
// tsc 6.0.2 for the tokens. The operand start comes from tsc's own tree (the postfix update that ends before the
// diagnostic), so only the scan is under test. usage: node scan-model.cjs
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
  const text = JSON.parse('"' + m[1].replace(/\\x([0-9a-f]{2})/g, (_, h) => "\\u00" + h) + '"');
  rows.push({ group, text: Buffer.from(text, "latin1").toString("utf8"), loader: m[2], code: +m[3], start: +m[4], end: +m[5] });
}
const endsExpression = k => k === K.Identifier || k === K.PrivateIdentifier || k === K.NumericLiteral || k === K.BigIntLiteral || k === K.StringLiteral || k === K.NoSubstitutionTemplateLiteral || k === K.TemplateTail || k === K.RegularExpressionLiteral || k === K.CloseParenToken || k === K.CloseBracketToken || k === K.CloseBraceToken || k === K.ThisKeyword || k === K.SuperKeyword || k === K.NullKeyword || k === K.TrueKeyword || k === K.FalseKeyword || k === K.PlusPlusToken || k === K.MinusMinusToken;
function scan(text, from, jsx) {
  const s = ts.createScanner(ts.ScriptTarget.Latest, true, jsx ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard, text);
  s.resetTokenState(from);
  const stack = [];
  let prev = K.Unknown, first = true;
  for (;;) {
    let k = s.scan();
    if (k === K.EndOfFileToken) return null;
    if ((k === K.SlashToken || k === K.SlashEqualsToken) && !endsExpression(prev)) k = s.reScanSlashToken();
    if (k === K.LessThanToken && jsx && !endsExpression(prev)) return null;
    if (k === K.OpenParenToken || k === K.OpenBracketToken || k === K.OpenBraceToken) stack.push(false);
    else if (k === K.TemplateHead) stack.push(true);
    else if (k === K.CloseParenToken || k === K.CloseBracketToken) { if (!stack.length) return null; stack.pop(); }
    else if (k === K.CloseBraceToken) {
      if (!stack.length) return null;
      if (stack[stack.length - 1]) { k = s.reScanTemplateToken(false); if (k === K.TemplateTail) stack.pop(); }
      else stack.pop();
    } else if ((k === K.PlusPlusToken || k === K.MinusMinusToken) && !stack.length && !first) {
      const operator = [s.getTokenStart(), s.getTokenEnd()];
      const next = s.scan();
      return { operator, next: [s.getTokenStart(), s.getTokenEnd()], newline: s.hasPrecedingLineBreak(), kind: K[next] };
    }
    prev = k; first = false;
  }
}
let checked = 0, failed = 0, skipped = 0;
for (const r of rows) {
  if (r.group !== "update-of-an-update" && r.group !== "after-an-update") continue;
  if (r.code === 1109) continue;
  const sf = ts.createSourceFile("x." + r.loader.toLowerCase(), r.text, ts.ScriptTarget.Latest, true, kinds[r.loader]);
  const toUnits = b => Buffer.from(r.text, "utf8").subarray(0, b).toString("utf8").length;
  const at = toUnits(r.start);
  // The update that ends last before the diagnostic, and is no part of parentheses that end before it.
  let best = null;
  const visit = n => { if (n.kind === K.PostfixUnaryExpression && n.end <= at && (!best || n.end > best.end || (n.end === best.end && n.pos < best.pos))) best = n; ts.forEachChild(n, visit); };
  visit(sf);
  if (!best) { skipped++; continue; }
  // `++a++`: the reference reports the operator itself.
  const operatorIsTheToken = best.end > at - 0 ? false : r.text.slice(best.end).trimStart().length !== r.text.slice(at).length;
  const found = scan(r.text, best.operand.getStart(sf), r.loader === "Tsx" || r.loader === "Jsx");
  checked++;
  const want = [at, toUnits(r.end)];
  const ok = found && ((found.next[0] === want[0] && found.next[1] === want[1]) || (found.operator[0] === want[0] && found.operator[1] === want[1]));
  if (!ok) { failed++; console.log("MISMATCH", JSON.stringify(r.text), r.loader, "want", want, "found", JSON.stringify(found)); }
}
console.log(`${checked} rows checked, ${failed} mismatches, ${skipped} rows without a postfix update before the diagnostic (JSX operands)`);
