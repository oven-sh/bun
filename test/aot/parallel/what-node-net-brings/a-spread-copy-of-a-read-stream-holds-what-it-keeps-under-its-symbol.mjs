import { createReadStream } from "node:fs";
const lineOf = text => text.split("\n").filter(line => line.includes("kFs")).map(line => line.trim().slice(0, 24)).join(" | ") || "no line";
const copy = { ...createReadStream(null, { fd: 0, autoClose: false }) };
console.log(lineOf(Bun.inspect(copy, { depth: +(process.argv[2] ?? 0) })));
process.exit(0);
