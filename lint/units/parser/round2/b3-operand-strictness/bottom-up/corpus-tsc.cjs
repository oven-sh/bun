// usage: node corpus-tsc.cjs <repo root> <out.jsonl>
// For every .ts .tsx .mts .cts .js .jsx .mjs .cjs file under test/ and src/js: the first parse diagnostic of tsc 6.0.2,
// and the places where a postfix update ends a statement whose next statement starts with "(", "[" or a template on a later line.
const ts = require("/workspace/bun/node_modules/typescript");
const fs = require("node:fs");
const path = require("node:path");
const root = process.argv[2];
const out = fs.createWriteStream(process.argv[3]);
const kinds = { ".ts": ts.ScriptKind.TS, ".mts": ts.ScriptKind.TS, ".cts": ts.ScriptKind.TS, ".tsx": ts.ScriptKind.TSX, ".js": ts.ScriptKind.JS, ".mjs": ts.ScriptKind.JS, ".cjs": ts.ScriptKind.JS, ".jsx": ts.ScriptKind.JSX };
function walkDir(dir, list) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return list; }
  for (const e of entries) {
    if (e.name === "node_modules" || e.name === ".git") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkDir(p, list);
    else if (kinds[path.extname(e.name)] !== undefined) list.push(p);
  }
  return list;
}
const files = [...walkDir(path.join(root, "test"), []), ...walkDir(path.join(root, "src/js"), [])];
const K = ts.SyntaxKind;
let n = 0, withDiag = 0, asi = 0, thrown = 0;
for (const f of files) {
  let text;
  try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
  if (text.length > 3_000_000) continue;
  n++;
  const ext = path.extname(f);
  let sf;
  try { sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, kinds[ext]); } catch (e) { thrown++; out.write(JSON.stringify({ f: path.relative(root, f), thrown: String(e).slice(0, 80) }) + "\n"); continue; }
  const d = sf.parseDiagnostics[0];
  const rec = { f: path.relative(root, f) };
  if (d) { withDiag++; rec.d = [d.code, d.start, d.length, ts.flattenDiagnosticMessageText(d.messageText, "\n").slice(0, 60)]; rec.n = sf.parseDiagnostics.length; }
  // a statement list where a statement ends in a postfix update (its last token is ++ or --) and the next one starts with ( [ or `
  const splits = [];
  const visit = node => {
    const list = node.statements;
    if (list) {
      for (let i = 0; i + 1 < list.length; i++) {
        const a = list[i], b = list[i + 1];
        const last = a.getLastToken(sf);
        if (!last || (last.kind !== K.PlusPlusToken && last.kind !== K.MinusMinusToken)) continue;
        const first = b.getFirstToken(sf);
        if (!first) continue;
        if (first.kind === K.OpenParenToken || first.kind === K.OpenBracketToken || first.kind === K.NoSubstitutionTemplateLiteral || first.kind === K.TemplateHead) splits.push(a.getStart(sf));
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  if (splits.length) { asi += splits.length; rec.splits = splits; }
  if (rec.d || rec.splits) out.write(JSON.stringify(rec) + "\n");
}
out.end();
console.log(JSON.stringify({ files: n, withParseDiagnostics: withDiag, postfixThenNewStatement: asi, thrown }));
