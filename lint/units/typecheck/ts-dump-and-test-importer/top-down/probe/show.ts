import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
import { importDump, print } from "./convert.mjs";
const CORPUS = process.env.CORPUS ?? "/tmp/tsimp/corpus";
const GOOUT = process.env.GOOUT ?? "/tmp/tsimp/go-out";
const HEADER = /^(file |externalModuleIndicator|commonJSModuleIndicator|usesUriStyleNodeCoreModules|counts |import |moduleAugmentation|ambientModuleName|pragma |referencedFile|typeReference|libReference|checkJs|commentDirective|diagnostic |jsDiagnostic |jsdocDiagnostic )/;
const vname = process.argv[2].replace(/:\d+$/, "");
const ctxn = Number(process.argv[3] ?? 3);
const raw = fs.readFileSync(path.join(CORPUS, vname), "utf8");
const lines = print(importDump(JSON.parse(JSON.stringify(dumpFiles([{ name: "/" + vname, text: raw }])))));
const go = fs.readFileSync(path.join(GOOUT, vname + ".tsgo.txt"), "utf8").split("\n").filter(l => l.length && !HEADER.test(l));
let i = 0;
while (i < go.length && i < lines.length && go[i] === lines[i]) i++;
if (i === go.length && i === lines.length) { console.log("SAME"); process.exit(0); }
for (let k = Math.max(0, i - ctxn); k < i; k++) console.log("   " + go[k]);
for (let k = i; k < Math.min(go.length, i + ctxn + 1); k++) console.log("GO " + go[k]);
for (let k = i; k < Math.min(lines.length, i + ctxn + 1); k++) console.log("TS " + lines[k]);
