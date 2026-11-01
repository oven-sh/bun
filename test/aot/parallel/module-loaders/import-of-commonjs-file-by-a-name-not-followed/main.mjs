// A CommonJS file that another module imports by a name, and import() finds it by a path that the build does not follow to the call.
import whole, { used } from "./lib/c.cjs";
const spec = process.argv[2] ?? "./lib/c.cjs";
const ns = await import(spec);
console.log(used(2), Object.keys(ns).sort().join(","), ns.unused(2), ns.default === whole, ns.used === used);
console.log((await import(spec)) === ns);
