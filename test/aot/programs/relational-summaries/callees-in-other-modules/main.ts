// The callee lives in another module: behind a live binding that its module stores to, a namespace object, a re-export, a default export, a CommonJS exports object that anybody may write, a dynamic import, a cycle of imports. What the caller believes about it must hold for the function that the binding holds at the call.
import defaultHelper, { helper, replaceHelper, keptByHelpers, makeThing, poolThings, counter, bump } from "./helpers.ts";
import * as namespace from "./helpers.ts";
import { helper as reexported, renamed } from "./reexports.ts";
import { early, readLate } from "./cycle-a.ts";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const common = require("./common.cjs") as { take(t: Thing): number; make(n: number): Thing; kept: Thing[] };
interface Thing {
  n: number;
  tag: string;
}
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
function round(i: number): number {
  const made = makeThing(i);
  made.n += 1;
  const fromCommon = common.make(i);
  fromCommon.n += 1;
  return (
    helper({ n: i, tag: "named " + i }) +
    namespace.helper({ n: i, tag: "namespace " + i }) +
    reexported({ n: i, tag: "re-exported " + i }) +
    renamed({ n: i, tag: "renamed " + i }) +
    defaultHelper({ n: i, tag: "default " + i }) +
    common.take({ n: i, tag: "common " + i }) +
    made.n +
    fromCommon.n
  );
}
let sum = 0;
for (let i = 0; i < 400; i++) sum += round(i);
console.log(sum, keptByHelpers.length, common.kept.length);
replaceHelper();
poolThings();
common.take = t => {
  common.kept.push(t);
  return -t.n;
};
const pooled = { n: 0, tag: "pooled in common" };
common.make = () => pooled;
for (let i = 400; i < 403; i++) sum += round(i);
console.log(sum, churn(60));
console.log(keptByHelpers.map(t => t.tag).join(" | "));
console.log(common.kept.map(t => t.tag).join(" | "), pooled.n, makeThing(0).n, makeThing(0) === makeThing(1));

// A live binding of a number.
console.log(counter, bump(), counter, namespace.counter, bump(), namespace.counter);

// A cycle: one module calls into the other before that has finished.
console.log(early, readLate());

// A dynamic import gives the same functions and the same state.
const dynamic = await import("./helpers.ts");
console.log(dynamic.helper === helper, dynamic.keptByHelpers === keptByHelpers, dynamic.helper({ n: 1, tag: "dynamic" }), keptByHelpers[keptByHelpers.length - 1].tag);

// The namespace object is handed to a helper that reads a name chosen at run time.
function callByName(ns: Record<string, unknown>, name: string, t: Thing): unknown {
  return (ns[name] as (t: Thing) => unknown)(t);
}
console.log(callByName(namespace, ["hel", "per"].join(""), { n: 2, tag: "by name" }), churn(20), keptByHelpers[keptByHelpers.length - 1].tag);
