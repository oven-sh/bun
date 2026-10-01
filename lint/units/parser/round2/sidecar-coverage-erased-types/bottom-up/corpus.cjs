// Makes, from every .ts/.tsx/.mts/.cts file that git tracks under test/ and src/js of a tree, the sources that show what the Build sink makes of its
// interfaces, type aliases and class index signatures:   let __x: { <members of an interface> };   class __C implements <heritage entries> {}   let __y: <type of an alias>;   let __z: { <index signature of a class> };
// usage: node corpus.cjs <tree> <out.hex> <out.meta.jsonl>     (hex lines: "<id> ts|tsx <hex>")
const ts = require("/workspace/bun/node_modules/typescript");
const fs = require("fs");
const cp = require("child_process");
const tree = process.argv[2];
const files = cp.execSync("git ls-files test src/js", { cwd: tree, maxBuffer: 1 << 28 }).toString().split("\n").filter(f => /\.(ts|tsx|mts|cts)$/.test(f));
const hex = fs.createWriteStream(process.argv[3]);
const meta = fs.createWriteStream(process.argv[4]);
let id = 0, nFiles = 0, nParsed = 0, counts = { interface: 0, heritage: 0, alias: 0, classIndex: 0 };
for (const file of files) {
  let text;
  try { text = fs.readFileSync(tree + "/" + file, "utf8"); } catch { continue; }
  nFiles++;
  const isTsx = file.endsWith(".tsx");
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, isTsx ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  if (sf.parseDiagnostics.length) continue;
  nParsed++;
  const emit = (kind, node, src) => {
    hex.write(`${id} ${isTsx ? "tsx" : "ts"} ${Buffer.from(src, "utf8").toString("hex")}\n`);
    meta.write(JSON.stringify({ id, kind, file, pos: node.getStart(sf) }) + "\n");
    id++; counts[kind]++;
  };
  const visit = node => {
    if (ts.isInterfaceDeclaration(node)) {
      const open = node.members.pos;            // after "{"
      emit("interface", node, `let __x: {${text.slice(open, node.end - 1)}};`);
      for (const clause of node.heritageClauses || []) {
        if (clause.types.length) emit("heritage", clause, `class __C implements ${text.slice(clause.types[0].getStart(sf), clause.types.end)} {}`);
      }
    } else if (ts.isTypeAliasDeclaration(node)) {
      emit("alias", node, `let __y: ${text.slice(node.type.getStart(sf), node.type.end)};`);
    } else if (ts.isClassLike(node)) {
      for (const member of node.members) if (member.kind === ts.SyntaxKind.IndexSignature) {
        const bracket = member.parameters.pos - 1;
        emit("classIndex", member, `let __z: {${text.slice(bracket, member.end)}};`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
}
hex.end(); meta.end();
console.log(JSON.stringify({ files: files.length, read: nFiles, parsedByTsc: nParsed, snippets: id, counts }));
