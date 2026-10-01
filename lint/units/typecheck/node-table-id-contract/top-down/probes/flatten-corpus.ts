// Like flatten-converted.ts, for every unit of the conformance corpus of the dump research, in bundles.
// A unit that the dump or the conversion model rejects becomes a file without nodes, so the order stays the manifest's.
// usage: NODE_PATH=/workspace/wt/typecheck/node_modules bun flatten-corpus.ts <manifest.json> <corpus dir> <out dir> [units per bundle]
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
const PROBE = "/workspace/notes/lint/units/typecheck/ts-dump-and-test-importer/top-down/probe";
const { dumpFiles } = await import(`${PROBE}/dump-ast.ts`);
const { importDump } = await import(`${PROBE}/convert.mjs`);
const [manifestFile, corpus, outDir, perBundleArg] = process.argv.slice(2);
const perBundle = Number(perBundleArg ?? 1000);
const manifest: { vname: string }[] = JSON.parse(readFileSync(manifestFile, "utf8"));
mkdirSync(outDir, { recursive: true });
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
let failed = 0, totalNodes = 0, bytes = 0;
const t0 = performance.now();
for (let start = 0, b = 0; start < manifest.length; start += perBundle, b++) {
  const kinds = new Interner(), fields = new Interner(), strings = new Interner();
  const files: any[] = [];
  for (const m of manifest.slice(start, start + perBundle)) {
    const empty = { fileName: "/" + m.vname, scriptKind: 0, languageVariant: 0, isDeclarationFile: 0, externalModuleIndicator: -1, nodes: [], lists: [], scalars: [], text: "" };
    try {
      const bundle = dumpFiles([{ name: "/" + m.vname, text: readFileSync(path.join(corpus, m.vname), "utf8") }]);
      const d = bundle.files[0];
      const root = importDump(bundle, 0);
      const nodes: number[] = [], lists: number[] = [], scalars: number[] = [];
      const indexOf = new Map<object, number>();
      let count = 0;
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
      files.push({ ...empty, scriptKind: d.scriptKind, languageVariant: d.languageVariant, isDeclarationFile: d.isDeclarationFile ? 1 : 0,
        externalModuleIndicator: root.externalModuleIndicator ? (indexOf.get(root.externalModuleIndicator) ?? -1) : -1, nodes, lists, scalars, text: d.text });
    } catch (e) {
      failed++;
      files.push(empty);
    }
  }
  const json = JSON.stringify({ v: 1, start, kinds: kinds.list, fields: fields.list, strings: strings.list, files });
  bytes += Buffer.byteLength(json);
  writeFileSync(path.join(outDir, `b${String(b).padStart(2, "0")}.json`), json);
}
console.log(JSON.stringify({ units: manifest.length, failed, nodes: totalNodes, jsonBytes: bytes, seconds: Math.round((performance.now() - t0) / 100) / 10 }));
