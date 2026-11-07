// Flags: --external left-out
// It guards against a crash: mid.mjs imports `left-out` by a statement, the build leaves that out, and a plugin of the run answers for it with the path of lib.mjs, whose `sum` the program enters with integers alone.
// What lib.mjs lists stays in, so the read of `got.sum` gets what plain Bun gives, or an error.
import { sum } from "./lib.mjs";
const table = { used() { return 1; }, never() { return import("./lib.mjs"); } };
let total = 0;
for (let i = 0; i < 300; i++) total = (sum(total, i) + table.used()) | 0;
console.log(String(total));
const target = import.meta.dir + "/" + JSON.parse('"lib"') + ".mjs";
Bun.plugin({ name: "late", setup(build) { build.onResolve({ filter: /^left-out$/ }, () => ({ path: target })); } });
let out = "asked";
try {
  const mid = await import("./mid.mjs");
  out = mid.probe();
} catch (e) { out += "|" + e.name + ":" + String(e.message).slice(0, 40); }
console.log(out === "function ab 1" || /\|[A-Za-z]*(Error|Message)/.test(out) ? "the right answer, or none" : "ANOTHER ANSWER: " + out);
