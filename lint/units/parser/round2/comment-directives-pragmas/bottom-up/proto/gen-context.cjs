// For each context vector: the comments that tsc sees between tokens (method of notes comments-oracle.cjs) and tsc's directives without duplicates.
const ts = require(process.env.ORACLE_TYPESCRIPT || "/workspace/bun/node_modules/typescript");
const fs = require("fs");
const lit = s => { let o = 'b"'; for (const b of Buffer.from(s, "utf8")) { if (b === 0x5c) o += "\\\\"; else if (b === 0x22) o += '\\"'; else if (b === 0x0a) o += "\\n"; else if (b === 0x0d) o += "\\r"; else if (b === 0x09) o += "\\t"; else if (b >= 0x20 && b < 0x7f) o += String.fromCharCode(b); else o += "\\x" + b.toString(16).padStart(2, "0"); } return o + '"'; };
const inputs = JSON.parse(fs.readFileSync(__dirname + "/../directives/context-inputs.json", "utf8"));
const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
let out = "pub const CONTEXT_VECTORS: &[(&str, &str, &[u8], &[(u32, u32)], &str)] = &[\n";
for (const [name, code, loader] of inputs) {
  const sf = ts.createSourceFile("x." + loader, code, ts.ScriptTarget.Latest, true, kinds[loader]);
  const found = new Map();
  const add = r => { if (r) for (const c of r) found.set(c.pos, c.end); };
  const isText = k => k === ts.SyntaxKind.JsxText || k === ts.SyntaxKind.JsxTextAllWhiteSpaces;
  (function walk(node) {
    const children = node.getChildren(sf);
    if (children.length === 0 || node.kind >= ts.SyntaxKind.FirstToken && node.kind <= ts.SyntaxKind.LastToken) {
      if (!isText(node.kind)) {
        add(ts.getLeadingCommentRanges(code, node.pos));
        add(ts.getTrailingCommentRanges(code, node.pos));
        add(ts.getTrailingCommentRanges(code, node.end));
        add(ts.getLeadingCommentRanges(code, node.end));
      }
      return;
    }
    for (const c of children) if (c.kind !== ts.SyntaxKind.JSDoc) walk(c);
  })(sf);
  const texts = [];
  (function collect(node) { if (isText(node.kind)) texts.push([node.pos, node.end]); node.forEachChild(collect); })(sf);
  const b = i => Buffer.byteLength(code.slice(0, i), "utf8");
  const list = [...found].filter(([p]) => !texts.some(([a, e]) => p >= a && p < e)).sort((a, c) => a[0] - c[0]).map(([p, e]) => `(${b(p)}, ${b(e)})`).join(", ");
  const seen = new Set(); const ds = [];
  for (const d of sf.commentDirectives || []) { const s = `${d.type === ts.CommentDirectiveType.ExpectError ? "ExpectError" : "Ignore"} ${b(d.range.pos)}..${b(d.range.end)}`; if (!seen.has(s)) { seen.add(s); ds.push(s); } }
  if (sf.parseDiagnostics.length) console.log("PARSE ERRORS in", name);
  out += `    (${JSON.stringify(name)}, ${JSON.stringify(loader)}, ${lit(code)}, &[${list}], ${JSON.stringify(ds.join(", "))}),\n`;
}
out += "];\n";
fs.appendFileSync(__dirname + "/vectors.rs", "\n" + out);
console.log("ok", inputs.length);
