// The order in which modules link, run, resume and fail: cycles, top-level await, a failure in a cycle, a cycle with awaiting members, a rejection after an await, require of ES modules, import() in a cycle, eviction, a hoisted function called before its module ran, an import of a name that a CommonJS module does not export. The exit code is 1 from the first module body to the last line, so a run that stalls fails.
import "./awaits-first.mjs";
import "./after-await.mjs";
import { fromB } from "./cycle-a.mjs";
async function attempt(label, run) {
  try {
    console.log(label + ":", await run());
  } catch (error) {
    console.log(label + ":", "throws", error.constructor.name);
  }
}
console.log("main starts", fromB);
await attempt("a failing cycle", () => import("./fails-a.mjs"));
await attempt("its other member", () => import("./fails-b.mjs"));
await attempt("the cycle again", () => import("./fails-a.mjs"));
await attempt("an absent name", () => import("./imports-absent-name.mjs"));
await attempt("the absent name again", () => import("./imports-absent-name.mjs"));
await attempt("an awaiting cycle", async () => Object.keys(await import("./awaiting-cycle-a.mjs")).join());
await attempt("its non-root member", async () => Object.keys(await import("./awaiting-cycle-b.mjs")).join());
await attempt("a rejection after an await", () => import("./rejected-root.mjs"));
await attempt("the module that rejected", () => import("./rejects-after-await.mjs"));
await attempt("a dependency that fulfills later", async () => Object.keys(await import("./fulfills-later.mjs")).join());
await attempt("a member of the rejected cycle", () => import("./rejected-cycle-member.mjs"));
await attempt("import() in a cycle", async () => (await import("./dynamic-cycle-a.mjs")).seen);
await attempt("required", async () => (await import("./requires.cjs")).default.join(" | "));
await attempt("imported after the require", async () => (await import("./awaits-when-required.mjs")).done);
console.log("main ends");
process.exitCode = 0;
