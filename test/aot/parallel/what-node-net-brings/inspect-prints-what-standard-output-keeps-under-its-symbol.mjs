import { inspect } from "node:util";
const lineOf = text => text.split("\n").filter(line => line.includes("kFs")).map(line => line.trim().slice(0, 24)).join(" | ") || "no line";
console.log(lineOf(inspect(process.stdout, { depth: +(process.argv[2] ?? 0) })));
