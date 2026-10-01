// usage: node oracle.cjs <file with one JSON array of sources>
// Prints, from tsc 6.0.2, what the tests of the erased type statements compare with:
//   a type alias: its name and the outline of its type; an interface: its clauses, its members and the outline of the types in them;
//   an index signature of a class: its modifiers, its parameters and the outline of its types.
// A heritage entry has the kind of typescript-go 89d5d5b (parseTypeHeritageClauseElement): tsc has ExpressionWithTypeArguments for every entry.
const ts = require("/workspace/bun/node_modules/typescript");
const fs = require("fs");
const K = ts.SyntaxKind;
const names = new Map();
for (const [name, value] of Object.entries(K)) if (typeof value === "number" && !/^(First|Last)/.test(name) && !names.has(value)) names.set(value, name);
const kindName = k => names.get(k);
function outline(sf, root) {
  const out = [];
  const range = list => `${list.pos},${list.end}`;
  const visit = node => {
    if (ts.isTypeNode(node) && node.kind !== K.TemplateLiteralTypeSpan && node.kind !== K.ExpressionWithTypeArguments) {
      let line = `${kindName(node.kind)}[${node.getStart(sf)},${node.end})`;
      if (node.typeArguments) line += `<${range(node.typeArguments)}>`;
      if ((ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) && node.typeParameters) line += `{${range(node.typeParameters)}}`;
      out.push(line);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
  return out.join(" ");
}
const isEntity = e => e.kind === K.Identifier ? e.text !== "" : (e.kind === K.PropertyAccessExpression && !e.questionDotToken && !(e.flags & ts.NodeFlags.OptionalChain) && isEntity(e.expression));
function describe(src, ext) {
  const sf = ts.createSourceFile("a." + (ext || "ts"), src, ts.ScriptTarget.Latest, true);
  const lines = [];
  if (sf.parseDiagnostics.length) lines.push("  PARSE DIAGNOSTICS: " + sf.parseDiagnostics.map(d => `TS${d.code}[${d.start},${d.start + d.length})`).join(" "));
  const visit = node => {
    if (ts.isTypeAliasDeclaration(node)) {
      lines.push(`  type-alias [${node.getStart(sf)},${node.end}) name=${node.name.text}@[${node.name.getStart(sf)},${node.name.end}) = ${outline(sf, node.type)}`);
    } else if (ts.isInterfaceDeclaration(node)) {
      let line = `  interface [${node.getStart(sf)},${node.end}) name=${node.name.text}@[${node.name.getStart(sf)},${node.name.end})`;
      for (const clause of node.heritageClauses || []) {
        const isType = clause.token === K.ExtendsKeyword;
        const first = clause.types.length ? clause.types[0].getStart(sf) : clause.types.pos;
        line += ` ${clause.token === K.ExtendsKeyword ? "extends" : "implements"}[${clause.getStart(sf)},${clause.end})(${first},${clause.types.end}):`;
        for (const entry of clause.types) {
          const kind = isType && isEntity(entry.expression) ? "TypeReference" : "ExpressionWithTypeArguments";
          line += ` ${kind}[${entry.getStart(sf)},${entry.end})` + (entry.typeArguments ? `<${entry.typeArguments.pos},${entry.typeArguments.end}>` : "");
          for (const arg of entry.typeArguments || []) { const o = outline(sf, arg); if (o) line += " " + o; }
        }
      }
      line += ` members(${node.members.pos},${node.members.end}):`;
      for (const member of node.members) {
        line += ` ${kindName(member.kind)}[${member.getStart(sf)},${member.end})`;
      }
      const types = node.members.map(m => outline(sf, m)).filter(Boolean).join(" ");
      if (types) line += ` types: ${types}`;
      lines.push(line);
    } else if (ts.isClassLike(node)) {
      for (const member of node.members) {
        if (member.kind !== K.IndexSignature) continue;
        let line = `  member index-signature [${member.getStart(sf)},${member.end})`;
        const mods = (member.modifiers || []).map(m => `${kindName(m.kind)}[${m.getStart(sf)},${m.end})`).join(" ");
        line += ` modifiers: ${mods || "-"}`;
        line += ` parameters(${member.parameters.pos},${member.parameters.end}):` + member.parameters.map(p => ` Parameter[${p.getStart(sf)},${p.end})`).join("");
        const types = outline(sf, member);
        line += ` types: ${types || "-"}`;
        lines.push(line);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return lines;
}
const inputs = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
for (const src of inputs) { console.log(JSON.stringify(src)); for (const l of describe(src, process.argv[3])) console.log(l); }
