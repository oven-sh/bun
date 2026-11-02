// Exports are read off namespace objects by code that does not know what it is handed: the namespace of a dynamic import(), `import * as`, two namespaces at the same places, bindings that change, re-exports, names that are absent, bindings that are not yet initialized.
// Env: JSC_aotCountsPath=/dev/null
import * as staticNamespace from "./lazy.js";
import { early } from "./cycle.js";
const count = typeof aotOperationCount === "function" ? aotOperationCount : () => 0;
const lines = [];
function say(...parts) {
  lines.push(parts.map(part => (typeof part === "string" ? part : JSON.stringify(part) ?? String(part))).join(" "));
}
function readTwo(ns) { return ns.alpha + ns.beta(1); }
function readDefault(ns) { return ns.default; }
function readAbsent(ns) { return ns.missing; }
function callBump(ns) { return ns.bump(); }
function attempt(label, run) {
  try {
    say(label, run());
  } catch (error) {
    say(label, "threw", error.constructor.name);
  }
}
const table = { readTwo, readDefault, readAbsent, callBump };
const lazy = await import("./lazy.js");
const other = await import("./other.js");
const star = await import("./star.js");

for (let i = 0; i < 60; ++i) {
  table.readTwo(lazy);
  table.readTwo(other);
  table.readDefault(lazy);
  table.readAbsent(other);
}
say("the same object", lazy === staticNamespace, lazy === (await import("./lazy.js")));
say("two exports", table.readTwo(lazy), table.readTwo(other), table.readTwo(star), table.readTwo(staticNamespace));
say("default", table.readDefault(lazy), table.readDefault(other), table.readDefault(star));
say("absent", table.readAbsent(lazy), table.readAbsent(other), lazy.then, lazy.toString, lazy.constructor);
say("a plain object at the same places", table.readTwo({ alpha: 5, beta: x => x }), table.readDefault({ default: "of an object" }), table.readAbsent({}));
say("a binding that changes", lazy.alpha, table.callBump(lazy), lazy.alpha, table.readTwo(lazy), table.callBump(lazy), table.readTwo(lazy), table.readTwo(star));
say("keys", Object.keys(lazy).join(), Object.keys(other).join(), Object.keys(star).join());
say("has", "alpha" in lazy, "missing" in lazy, Object.hasOwn(lazy, "default"), Reflect.has(star, "gamma"));
say("tag", lazy[Symbol.toStringTag], Object.prototype.toString.call(lazy));
const descriptor = Object.getOwnPropertyDescriptor(lazy, "alpha");
say("described", descriptor.value, descriptor.writable, descriptor.enumerable, descriptor.configurable);
attempt("stored to", () => { lazy.alpha = 99; return "stored"; });
attempt("a new name stored", () => { lazy.fresh = 1; return "stored"; });
attempt("deleted", () => delete lazy.alpha);
attempt("an absent name deleted", () => delete lazy.missing);
say("still", table.readTwo(lazy), Object.isFrozen(lazy), Object.isSealed(lazy), Object.isExtensible(lazy));
say("read too early", early);
const { alpha, beta, default: byDefault } = lazy;
say("destructured", alpha, beta(2), byDefault);
say("spread", { ...other }.alpha, Object.entries(other).map(([name, value]) => name + ":" + typeof value).join());
{
  let sum = 0;
  const before = count("operationAOTGetByIdAndCache");
  for (let i = 0; i < 3000; ++i) sum += table.readTwo(i % 2 ? lazy : other) + table.readDefault(lazy).length + table.readTwo(staticNamespace);
  const asked = count("operationAOTGetByIdAndCache") - before;
  say("rounds", sum);
  say(asked <= 200 ? "the reads asked the run time at most 200 times" : "the reads asked the run time " + asked + " times");
}
console.log(lines.join("\n"));
