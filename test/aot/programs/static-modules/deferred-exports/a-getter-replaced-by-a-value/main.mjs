import fs from "node:fs";
Object.defineProperty(fs, "promises", { value: { readFile: async () => "not a file" }, configurable: true, enumerable: true });
const rest = await import("./rest.mjs");
console.log(await rest.read());
