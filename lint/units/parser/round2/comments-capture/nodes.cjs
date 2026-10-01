// node nodes2.cjs <inputs.json>  ->  per input: every node that is no token, with pos (full start), start and end in UTF-8 bytes; lists with pos and end.
const ts = require("/workspace/wt/parser/node_modules/typescript");
const inputs = JSON.parse(require("fs").readFileSync(process.argv[2], "utf8"));
const K = ts.SyntaxKind;
for (const [name, loader, code] of inputs) {
  const kinds = { ts: ts.ScriptKind.TS, tsx: ts.ScriptKind.TSX, js: ts.ScriptKind.JS, jsx: ts.ScriptKind.JSX };
  const sf = ts.createSourceFile("x." + loader, code, ts.ScriptTarget.Latest, true, kinds[loader]);
  const b = i => Buffer.byteLength(code.slice(0, i), "utf8");
  console.log(`--- ${name} [${loader}] ${JSON.stringify(code)}`);
  (function walk(n, depth) {
    if (n.kind !== K.SourceFile && !(n.kind >= K.FirstToken && n.kind <= K.LastToken) && n.kind !== K.Identifier) {
      let extra = "";
      for (const key of ["modifiers", "typeArguments", "typeParameters", "parameters", "members", "types", "elements"]) {
        if (n[key] && n[key].pos !== undefined) extra += ` ${key}[${b(n[key].pos)},${b(n[key].end)})`;
      }
      console.log(`${" ".repeat(depth)}${K[n.kind]} pos=${b(n.pos)} start=${b(n.getStart(sf))} end=${b(n.end)}${extra}`);
    }
    n.forEachChild(c => walk(c, depth + 1));
  })(sf, 0);
}
