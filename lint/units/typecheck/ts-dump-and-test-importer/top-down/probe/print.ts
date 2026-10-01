import fs from "node:fs";
import { dumpFiles } from "./dump-ast.ts";
import { importDump, print } from "./convert.mjs";
const [file, name] = process.argv.slice(2);
const raw = fs.readFileSync(file, "utf8");
console.log(print(importDump(JSON.parse(JSON.stringify(dumpFiles([{ name: name ?? "/" + file.split("/").pop(), text: raw }]))))).join("\n"));
