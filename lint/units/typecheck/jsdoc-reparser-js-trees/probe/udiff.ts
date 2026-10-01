// Probe: unified diff of the Go golden tree and the converted tree of one unit.
import fs from "node:fs";
import path from "node:path";
import { dumpFiles } from "./dump-ast.ts";
import { importDump, print } from "./convert.mjs";
const CORPUS = process.env.CORPUS ?? "/tmp/tsimp/corpus";
const GOOUT = process.env.GOOUT ?? "/tmp/tsimp/go-out";
const HEADER = /^(diagnostic\.related|jsDiagnostic\.related|jsdocDiagnostic\.related|file |externalModuleIndicator|commonJSModuleIndicator|usesUriStyleNodeCoreModules|counts |import |moduleAugmentation|ambientModuleName|pragma |referencedFile|typeReference|libReference|checkJs|commentDirective|diagnostic |jsDiagnostic |jsdocDiagnostic )/;
const vname = process.argv[2].replace(/:\d+$/, "");
const raw = fs.readFileSync(path.join(CORPUS, vname), "utf8");
const lines = print(importDump(JSON.parse(JSON.stringify(dumpFiles([{ name: "/" + vname, text: raw }])))));
const go = fs.readFileSync(path.join(GOOUT, vname + ".tsgo.txt"), "utf8").split("\n").filter(l => l.length && !HEADER.test(l));
fs.writeFileSync("/tmp/jsdocrp/_go.txt", go.join("\n") + "\n");
fs.writeFileSync("/tmp/jsdocrp/_ts.txt", lines.join("\n") + "\n");
