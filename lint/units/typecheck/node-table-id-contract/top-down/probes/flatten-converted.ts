// Makes the input of the prototype's importer: the tree of TypeScript 6.0.2, converted to typescript-go's shape
// by the model of the dump research (ts-dump-and-test-importer/top-down/probe/convert.mjs), written flat.
// The nodes are written in the order the converter holds them (TypeScript's property order), not in
// ForEachChild order: the builder's finish() has to produce that order itself.
// usage: NODE_PATH=/workspace/wt/typecheck/node_modules bun flatten-converted.ts <out.json> <name>=<path>...
//        ... <out.json> --list <file with one path per line>
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const PROBE = "/workspace/notes/lint/units/typecheck/ts-dump-and-test-importer/top-down/probe";
const { dumpFiles } = await import(`${PROBE}/dump-ast.ts`);
const { importDump } = await import(`${PROBE}/convert.mjs`);

class Interner {
  list: string[] = [];
  index = new Map<string, number>();
  add(s: string): number {
    let i = this.index.get(s);
    if (i === undefined) {
      i = this.list.length;
      this.list.push(s);
      this.index.set(s, i);
    }
    return i;
  }
}

const args = process.argv.slice(2);
const out = args.shift()!;
const inputs: { name: string; text: string }[] = [];
if (args[0] === "--list") {
  for (const f of readFileSync(args[1], "utf8").split("\n").filter(Boolean)) inputs.push({ name: "/" + path.basename(f), text: readFileSync(f, "utf8") });
} else {
  for (const a of args) {
    const eq = a.indexOf("=");
    inputs.push({ name: a.slice(0, eq), text: readFileSync(a.slice(eq + 1), "utf8") });
  }
}
const t0 = performance.now();
const bundle = dumpFiles(inputs);
const t1 = performance.now();
const kinds = new Interner(), fields = new Interner(), strings = new Interner();
const files: any[] = [];
let totalNodes = 0;
for (let fi = 0; fi < bundle.files.length; fi++) {
  const d = bundle.files[fi];
  const root = importDump(bundle, fi);
  const nodes: number[] = [], lists: number[] = [], scalars: number[] = [];
  const indexOf = new Map<object, number>();
  let count = 0;
  // parent: node index or -1; field: index of the Go field name, -1 for a list element and the root, -2 for JSDoc.
  const visit = (n: any, parent: number, field: number, list: number) => {
    const me = count++;
    indexOf.set(n, me);
    nodes.push(kinds.add(n.kind), n.pos, n.end, n.flags >>> 0, parent, field, list);
    for (const [name, v] of n.scalars) {
      const f = fields.add(name);
      if ("k" in v) scalars.push(me, f, 1, kinds.add(v.k));
      else if ("x" in v) scalars.push(me, f, 3, v.x >>> 0);
      else if ("s" in v) scalars.push(me, f, 2, strings.add(v.s));
      else if ("b" in v) { if (v.b) scalars.push(me, f, 0, 1); }
    }
    for (const [name, c] of n.children) {
      const f = fields.add(name);
      if (c.list) {
        const li = lists.length / 6;
        lists.push(me, f, c.pos, c.end, c.modifiers ? 1 : c.raw ? 2 : 0, c.modifiers ? c.modifierFlags >>> 0 : 0);
        for (const x of c.nodes) visit(x, me, -1, li);
      } else visit(c, me, f, -1);
    }
    for (const j of n.jsdoc) visit(j, me, -2, -1);
  };
  visit(root, -1, -1, -1);
  totalNodes += count;
  files.push({
    fileName: d.fileName, scriptKind: d.scriptKind, languageVariant: d.languageVariant, isDeclarationFile: d.isDeclarationFile ? 1 : 0,
    externalModuleIndicator: root.externalModuleIndicator ? (indexOf.get(root.externalModuleIndicator) ?? -1) : -1,
    nodes, lists, scalars, text: d.text,
  });
}
const t2 = performance.now();
const json = JSON.stringify({ v: 1, kinds: kinds.list, fields: fields.list, strings: strings.list, files });
writeFileSync(out, json);
console.log(JSON.stringify({ files: files.length, nodes: totalNodes, jsonBytes: Buffer.byteLength(json), ms: { parseAndDump: Math.round(t1 - t0), convert: Math.round(t2 - t1), write: Math.round(performance.now() - t2) } }));
