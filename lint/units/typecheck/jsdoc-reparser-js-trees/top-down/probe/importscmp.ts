// Probe: file.imports of JavaScript units (parser/references.go collectExternalModuleReferences, with the JSDoc-aware
// ast.GetNodeAtPosition) computed on the route A tree, against the `import` lines of typescript-go's dump.
import fs from "node:fs";
import { importRouteA } from "./difftree2.ts";
import { goKindIndex, byKind } from "./gotable.mjs";
import { quoteToASCII, GOF } from "./convert.mjs";
const FIRST_NODE = goKindIndex.get("QualifiedName")!;
const get = (n: any, name: string) => n?.children.get(name);
const textOf = (n: any) => n?.scalars.get("Text")?.s ?? "";
function childrenInOrder(g: any): any[] {
  const e = byKind.get(g.kind);
  const order: string[] = e ? e.memberOrder : [];
  const names = [...order.filter(n => g.children.has(n)), ...[...g.children.keys()].filter(k => !order.includes(k))];
  const out: any[] = [];
  for (const name of names) { const c = g.children.get(name); if (c.list) out.push(...c.nodes); else out.push(c); }
  return out;
}
const contains = (n: any, p: number) => (goKindIndex.get(n.kind) ?? 0) >= FIRST_NODE && n.pos <= p && (p < n.end || (p === n.end && n.kind === "EndOfFile"));
function getNodeAtPosition(root: any, position: number, includeJSDoc: boolean) {
  let current = root;
  for (;;) {
    let child: any;
    if (includeJSDoc) for (const j of current.jsdoc) if (contains(j, position)) { child = j; break; }
    if (!child) for (const c of current.kind === "SourceFile" ? [...get(current, "Statements").nodes, get(current, "EndOfFileToken")] : childrenInOrder(current)) if (contains(c, position)) { child = c; break; }
    if (!child || child.kind === "MetaProperty") return current;
    current = child;
  }
}
function findImportOrRequire(b: Buffer, start: number): [number, number] {
  let index = Math.max(start, 0);
  while (index < b.length) {
    while (index < b.length && b[index] !== 0x69 && b[index] !== 0x72) index++;
    if (index >= b.length) break;
    const expected = b[index] === 0x69 ? "import" : "require";
    if (index + expected.length <= b.length && b.subarray(index, index + expected.length).toString("latin1") === expected) return [index, expected.length];
    index++;
  }
  return [-1, 0];
}
const isStringLiteralLike = (n: any) => n?.kind === "StringLiteral" || n?.kind === "NoSubstitutionTemplateLiteral";
const isRelative = (s: string) => /^\.\.?($|[\\/])/.test(s) || /^[\\/]/.test(s) || /^[a-zA-Z]:[\\/]/.test(s);
function collect(root: any, b: Buffer, isDts: boolean) {
  const imports: any[] = [];
  const emi = root.externalModuleIndicator;
  for (const s of get(root, "Statements").nodes) (function refs(node: any, inAmbientModule: boolean): void {
    if (["ImportDeclaration", "ImportEqualsDeclaration", "JSImportDeclaration", "ExportDeclaration"].includes(node.kind)) {
      let e: any;
      if (node.kind === "ImportEqualsDeclaration") { const r = get(node, "ModuleReference"); e = r?.kind === "ExternalModuleReference" ? get(r, "Expression") : undefined; }
      else e = get(node, "ModuleSpecifier");
      if (e && e.kind === "StringLiteral") { const name = textOf(e); if (name !== "" && (!inAmbientModule || !isRelative(name))) imports.push(e); }
      return;
    }
    if (node.kind === "ModuleDeclaration" && (get(node, "name")?.kind === "StringLiteral" || node.scalars.get("Keyword")?.k === "GlobalKeyword") &&
        (inAmbientModule || ((get(node, "modifiers")?.modifierFlags ?? 0) & (1 << 7)) || isDts)) {
      const nameText = textOf(get(node, "name"));
      if (!(emi || (inAmbientModule && !isRelative(nameText))) && !inAmbientModule) { const body = get(node, "Body"); if (body) for (const st of get(body, "Statements")?.nodes ?? []) refs(st, true); }
    }
  })(s, false);
  const isJS = (root.flags & GOF.JavaScriptFile) !== 0;
  if ((root.flags & GOF.PossiblyContainsDynamicImport) || isJS) {
    let [last, size] = findImportOrRequire(b, 0);
    while (last >= 0) {
      const node = getNodeAtPosition(root, last, isJS);
      const args = get(node, "Arguments")?.nodes ?? [];
      if (isJS && node.kind === "CallExpression" && get(node, "Expression")?.kind === "Identifier" && textOf(get(node, "Expression")) === "require" && args.length === 1 && isStringLiteralLike(args[0])) imports.push(args[0]);
      else if (node.kind === "CallExpression" && get(node, "Expression")?.kind === "ImportKeyword" && args.length > 0 && isStringLiteralLike(args[0])) imports.push(args[0]);
      else if (node.kind === "ImportType" && get(node, "Argument")?.kind === "LiteralType" && get(get(node, "Argument"), "Literal")?.kind === "StringLiteral") imports.push(get(get(node, "Argument"), "Literal"));
      last += size;
      [last, size] = findImportOrRequire(b, last);
    }
  }
  return imports.map(e => `import Kind${e.kind}[${e.pos},${e.end}) ${quoteToASCII(textOf(e))}`);
}
const sameTrees = new Set(fs.readFileSync(process.env.SAME ?? "/tmp/jsr/r5u.same.txt", "utf8").split("\n").filter(Boolean));
const filter = new RegExp(process.argv[2] ?? "\\.(js|jsx|mjs|cjs)$");
let n = 0, withImports = 0, same = 0, differ = 0, differSame = 0, inJsdoc = 0; const ex: string[] = [];
for (const vname of fs.readdirSync("/tmp/tsimp/corpus").sort()) {
  if (!filter.test(vname)) continue;
  n++;
  const go = fs.readFileSync("/tmp/tsimp/go-out/" + vname + ".tsgo.txt", "utf8").split("\n").filter(l => l.startsWith("import "));
  const { root, d } = importRouteA(vname, fs.readFileSync("/tmp/tsimp/corpus/" + vname, "utf8"));
  const mine = collect(root, Buffer.from(d.text, "utf8"), d.isDeclarationFile);
  if (!go.length && !mine.length) continue;
  withImports++;
  if (go.join("\n") === mine.join("\n")) same++;
  else { differ++; if (sameTrees.has(vname)) differSame++; if (ex.length < 6) ex.push(`${vname}${sameTrees.has(vname) ? "" : " (tree differs)"}\n      go   ${go.join(" | ")}\n      mine ${mine.join(" | ")}`); }
}
console.log(`units ${n}: with imports ${withImports}, equal ${same}, different ${differ} (on a tree equal to typescript-go's: ${differSame})`);
for (const e of ex) console.log("  ", e);
