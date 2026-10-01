// Prints, for each source, what a lint parse has to record of its interfaces, its type aliases and the index signatures of
// its classes: one line for each, by where it starts, with the kind and the range of every node. Source of truth: tsc 6.0.2.
// The kinds are those of typescript-go where the two differ: an entry of `extends` of an interface (and of `implements` of a
// class) that is a name alone or a dotted name is a TypeReference, every other entry an ExpressionWithTypeArguments.
// usage: node payload-oracle.cjs inputs.json        inputs: [{ name, text, kind? }] or ["text", ...]
//        node payload-oracle.cjs --rust inputs.json prints the rows of the Rust table (name, text, lines)
// A source that tsc does not parse prints its first diagnostic instead: `error TS<code> [start,end) <text>`.
const ts = require(process.env.TYPESCRIPT || "/workspace/wt/parser/node_modules/typescript");
const K = ts.SyntaxKind;
const names = new Map();
for (const [name, value] of Object.entries(K)) if (typeof value === "number" && !names.has(value)) names.set(value, name);

function typeOutline(sf, root, out) {
  const range = list => `${list.pos},${list.end}`;
  const visit = node => {
    if (ts.isTypeNode(node) && node.kind !== K.TemplateLiteralTypeSpan) {
      let kind = names.get(node.kind);
      if (node.kind === K.ExpressionWithTypeArguments && isEntityNameExpression(node.expression) && readsTypeReference(node)) kind = "TypeReference";
      let line = `${kind}[${node.getStart(sf)},${node.end})`;
      if (node.typeArguments) line += `<${range(node.typeArguments)}>`;
      if ((ts.isFunctionTypeNode(node) || ts.isConstructorTypeNode(node)) && node.typeParameters) line += `{${range(node.typeParameters)}}`;
      out.push(line);
    }
    ts.forEachChild(node, visit);
  };
  visit(root);
}
// isValidHeritageTypeReferenceExpression of typescript-go
function isEntityNameExpression(node) {
  if (node.kind === K.Identifier) return true;
  return node.kind === K.PropertyAccessExpression && !node.questionDotToken && !(node.flags & ts.NodeFlags.OptionalChain) && node.name.kind === K.Identifier && isEntityNameExpression(node.expression);
}
// isTypeHeritageClause of typescript-go
function readsTypeReference(node) {
  const clause = node.parent;
  if (!clause || clause.kind !== K.HeritageClause) return false;
  const isInterface = clause.parent.kind === K.InterfaceDeclaration;
  return isInterface ? clause.token === K.ExtendsKeyword : clause.token === K.ImplementsKeyword;
}
function modifierWord(node) {
  if (node.kind === K.Decorator) return "Decorator";
  return names.get(node.kind).replace(/Keyword$/, "");
}
function signatureOutline(sf, node, out, withName) {
  for (const m of node.modifiers || []) out.push(`${modifierWord(m)}[${m.getStart(sf)},${m.end})`);
  if (withName && node.name) out.push(`name[${node.name.getStart(sf)},${node.name.end})`);
  if (node.questionToken) out.push(`?[${node.questionToken.getStart(sf)},${node.questionToken.end})`);
  if (node.typeParameters) {
    out.push(`typeParameters[${node.typeParameters.pos},${node.typeParameters.end})`);
    for (const tp of node.typeParameters) {
      out.push(`TypeParameter[${tp.getStart(sf)},${tp.end})`);
      if (tp.constraint) typeOutline(sf, tp.constraint, out);
      if (tp.default) typeOutline(sf, tp.default, out);
    }
  }
  if (node.parameters) {
    out.push(`parameters[${node.parameters.pos},${node.parameters.end})`);
    for (const p of node.parameters) {
      out.push(`Parameter[${p.getStart(sf)},${p.end})`);
      if (p.type) typeOutline(sf, p.type, out);
    }
  }
  if (node.type) typeOutline(sf, node.type, out);
}
function typeParametersOf(sf, node, out) {
  if (!node.typeParameters) return;
  // `<` to after `>`: the list of tsc starts after `<` and ends before `>`
  const lt = sf.text.lastIndexOf("<", node.typeParameters.pos - 1);
  const gt = sf.text.indexOf(">", node.typeParameters.end);
  out.push(`typeParameters[${lt},${gt + 1})`);
}
function lines(sf) {
  const found = [];
  const visit = node => {
    if (node.kind === K.TypeAliasDeclaration) {
      const out = [`TypeAliasDeclaration[${node.getStart(sf)},${node.end})`, `name[${node.name.getStart(sf)},${node.name.end})`];
      typeParametersOf(sf, node, out);
      typeOutline(sf, node.type, out);
      found.push([node.getStart(sf), out.join(" ")]);
    } else if (node.kind === K.InterfaceDeclaration) {
      const out = [`InterfaceDeclaration[${node.getStart(sf)},${node.end})`, `name[${node.name.getStart(sf)},${node.name.end})`];
      typeParametersOf(sf, node, out);
      for (const clause of node.heritageClauses || []) {
        out.push(`${clause.token === K.ExtendsKeyword ? "extends" : "implements"}[${clause.getStart(sf)},${clause.end})`);
        for (const entry of clause.types) typeOutline(sf, entry, out);
      }
      out.push(`members[${node.members.pos},${node.members.end})`);
      for (const member of node.members) {
        out.push(`${names.get(member.kind)}[${member.getStart(sf)},${member.end})`);
        signatureOutline(sf, member, out, true);
      }
      found.push([node.getStart(sf), out.join(" ")]);
    } else if (node.kind === K.IndexSignature && (node.parent.kind === K.ClassDeclaration || node.parent.kind === K.ClassExpression)) {
      const out = [`IndexSignature[${node.getStart(sf)},${node.end})`];
      signatureOutline(sf, node, out, false);
      found.push([node.getStart(sf), out.join(" ")]);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  found.sort((a, b) => a[0] - b[0]);
  return found.map(f => f[1]);
}
function run(input) {
  const kind = input.kind || "ts";
  const file = kind === "dts" ? "/a.d.ts" : "/a." + kind;
  const sf = ts.createSourceFile(file, input.text, ts.ScriptTarget.Latest, true);
  const d = sf.parseDiagnostics[0];
  if (d) return [`error TS${d.code} [${d.start},${d.start + d.length}) ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`];
  return lines(sf);
}
module.exports = { run };
if (require.main === module) {
  const args = process.argv.slice(2);
  const rust = args[0] === "--rust" && args.shift();
  const raw = JSON.parse(require("fs").readFileSync(args[0], "utf8"));
  const inputs = raw.map((r, i) => (typeof r === "string" ? { name: String(i), text: r } : r));
  const q = s => JSON.stringify(s).replace(/\\u([0-9a-f]{4})/g, "\\u{$1}");
  for (const input of inputs) {
    const out = run(input);
    if (rust) {
      console.log(`    Payloads {\n        name: ${q(input.name)},\n        text: b${q(input.text)},\n        lines: &[\n${out.map(l => `            ${q(l)},`).join("\n")}\n        ],\n    },`);
    } else {
      console.log(`# ${input.name}: ${JSON.stringify(input.text)}`);
      for (const l of out) console.log(l);
    }
  }
}
