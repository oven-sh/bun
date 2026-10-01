// Probe: the external module indicator of JavaScript units after the reparse pass, against typescript-go's.
import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
import { importDump, ruleHits } from "./convert.mjs";
const CORPUS = process.env.CORPUS ?? "/tmp/tsimp/corpus", GOOUT = process.env.GOOUT ?? "/tmp/jsdocrp/go-js";
const filter = new RegExp(process.argv[2] ?? "\\.(js|jsx|mjs|cjs)$");
let n = 0, same = 0; const bad: string[] = [];
for (const vname of fs.readdirSync(CORPUS).sort()) {
  if (!filter.test(vname)) continue;
  n++;
  const go = fs.readFileSync(path.join(GOOUT, vname + ".tsgo.txt"), "utf8").split("\n").find(l => l.startsWith("externalModuleIndicator "))!;
  const root = importDump(JSON.parse(JSON.stringify(dumpFiles([{ name: "/" + vname, text: fs.readFileSync(path.join(CORPUS, vname), "utf8") }]))));
  const e = root.externalModuleIndicator;
  const mine = "externalModuleIndicator " + (e ? `Kind${e.kind}[${e.pos},${e.end})` : "<nil>");
  if (mine === go) same++; else bad.push(`${vname}: go ${go.slice(24)} port ${mine.slice(24)}`);
}
console.log(`units ${n}, same indicator ${same}`, [...ruleHits].filter(x => String(x[0]).startsWith("module-indicator")));
for (const b of bad.slice(0, 20)) console.log("  " + b);
