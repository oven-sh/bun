import { used } from "./lib/c.cjs";
const spec = process.argv[2] ?? "./lib/c.cjs";
const ns = await import(spec);
console.log(used(2), Object.keys(ns).sort().join(","), typeof ns.unused === "function" ? ns.unused(2) : typeof ns.unused);
