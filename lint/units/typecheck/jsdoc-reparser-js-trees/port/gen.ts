// SCRATCH: for every JavaScript unit, the tree that a base importer builds (TypeScript 6.0.2 dump, base conversion rules, no JavaScript step), printed like the Go probe.
import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
import { importDump as importBase, print as printBase } from "./convert-base.mjs";
import { importDump as importFull, print as printFull } from "./convert.mjs";
const CORPUS = process.env.CORPUS ?? "/tmp/tsimp/corpus";
const OUT = process.env.OUT ?? "/tmp/jsrp/pre";
const PROTO = process.env.PROTO ?? "/tmp/jsrp/proto";
const filter = new RegExp(process.argv[2] ?? "\\.(js|jsx|mjs|cjs)$");
let n = 0;
for (const vname of fs.readdirSync(CORPUS).sort()) {
  if (!filter.test(vname)) continue;
  const raw = fs.readFileSync(path.join(CORPUS, vname), "utf8");
  const text = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
  const bundle = dumpFiles([{ name: "/" + vname, text: raw }]);
  const f = bundle.files[0];
  const head = [
    `parseDiagnostics ${f.diagnostics.map((d: any) => `${d[0]},${d[0] + d[1]},${d[2]}`).join(" ")}`,
  ];
  const base = importBase(JSON.parse(JSON.stringify(bundle)), 0);
  fs.writeFileSync(path.join(OUT, vname + ".tree"), head.concat(printBase(base)).join("\n") + "\n");
  fs.writeFileSync(path.join(OUT, vname + ".src"), Buffer.from(text, "utf8"));
  const full = importFull(JSON.parse(JSON.stringify(bundle)), 0);
  fs.writeFileSync(path.join(PROTO, vname + ".tree"), printFull(full).join("\n") + "\n");
  n++;
}
console.log(`units ${n}`);
