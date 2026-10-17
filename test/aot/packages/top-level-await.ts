// Top-level await in a dependency: the order of evaluation, rejections, cycles.
import { js, pkg, ts, type Case } from "./run-packages";

export const cases: Case[] = [
  {
    name: "top-level-await",
    fails: true,
    files: {
      ...pkg("tla", {
        "log.mjs": `export const log = [];
`,
        "slow.mjs": `import { log } from "./log.mjs";
log.push("slow start");
await new Promise((r) => setTimeout(r, 20));
log.push("slow end");
export const slow = "slow";
`,
        "fast.mjs": `import { log } from "./log.mjs";
log.push("fast start");
await null;
log.push("fast end");
export const fast = "fast";
`,
        "sync.mjs": `import { log } from "./log.mjs";
log.push("sync");
export const sync = "sync";
`,
        "parent.mjs": `import { log } from "./log.mjs";
import { slow } from "./slow.mjs";
import { sync } from "./sync.mjs";
import { fast } from "./fast.mjs";
log.push("parent");
export const all = [slow, sync, fast];
`,
        "rejects.mjs": `import { log } from "./log.mjs";
log.push("rejects start");
await Promise.reject(new RangeError("rejected"));
export const never = 1;
`,
        "over_rejects.mjs": `import { never } from "./rejects.mjs";
export const x = never;
`,
        "value.mjs": `export const v = await Promise.resolve({ n: 1 });
export let w = 0;
w = await Promise.resolve(5);
export default await Promise.resolve("awaited default");
`,
        "value.d.mts": `export declare const v: { n: number };
export declare let w: number;
declare const d: string;
export default d;
`,
        "for_await.mjs": `async function* g() { yield 1; yield 2; }
export const got = [];
for await (const x of g()) got.push(x);
`,
        "in_block.mjs": `export let v = "unset";
if (true) { v = await Promise.resolve("set in a block"); }
try { await Promise.reject(new Error("x")); } catch (e) { v += " caught"; } finally { v += await Promise.resolve(" finally"); }
`,
        "cyc_a.mjs": `import { log } from "./log.mjs";
import { b } from "./cyc_b.mjs";
log.push("cyc_a start");
await null;
log.push("cyc_a end");
export const a = "a" + b;
`,
        "cyc_b.mjs": `import { log } from "./log.mjs";
import * as A from "./cyc_a.mjs";
log.push("cyc_b start");
await null;
log.push("cyc_b end");
export const b = "b";
export const seeA = () => A.a;
`,
        "dyn_in_tla.mjs": `const m = await import("./sync.mjs");
export const got = m.sync;
`,
        "using.mjs": `export const log = [];
{ await using r = { async [Symbol.asyncDispose]() { log.push("disposed"); } }; log.push("in"); }
log.push("out");
`,
      }),
    },
    importers: {
      "order.mjs": `import { all } from "tla/parent.mjs";
import { log } from "tla/log.mjs";
${js}t("x", () => [all, log]);
`,
      "order_siblings.mjs": `import { log } from "tla/log.mjs";
import "tla/slow.mjs";
import "tla/fast.mjs";
import "tla/sync.mjs";
${js}t("x", () => log);
`,
      "value.mjs": `import d, { v, w } from "tla/value.mjs";
${js}t("x", () => [d, v, w]);
`,
      "value.ts": `import d, { v, w } from "tla/value.mjs";
${ts}t("x", () => [d.length, v.n + 1, w + 1]);
`,
      "value_ns.mjs": `import * as ns from "tla/value.mjs";
${js}t("x", () => [keys(ns), ns.default, ns.v, ns.w]);
`,
      "dyn_twice.mjs": `${js}const [a, b] = await Promise.all([import("tla/slow.mjs"), import("tla/slow.mjs")]);
const { log } = await import("tla/log.mjs");
t("x", () => [a === b, a.slow, log]);
`,
      "dyn_not_awaited.mjs": `${js}import { log } from "tla/log.mjs";
const p = import("tla/slow.mjs");
t("now", () => log.slice());
await p;
t("then", () => log);
`,
      "rejects_dyn.mjs": `${js}await ta("1", () => import("tla/rejects.mjs"));
await ta("2", () => import("tla/rejects.mjs"));
await ta("over", () => import("tla/over_rejects.mjs"));
`,
      "rejects_static.mjs": `import "tla/over_rejects.mjs";
console.log("never");
`,
      "for_await.mjs": `import { got } from "tla/for_await.mjs";
${js}t("x", () => got);
`,
      "in_block.mjs": `import { v } from "tla/in_block.mjs";
${js}t("x", () => v);
`,
      "cycle.mjs": `import { a } from "tla/cyc_a.mjs";
import { seeA } from "tla/cyc_b.mjs";
import { log } from "tla/log.mjs";
${js}t("x", () => [a, seeA(), log]);
`,
      "dyn_in_tla.mjs": `import { got } from "tla/dyn_in_tla.mjs";
${js}t("x", () => got);
`,
      "using.mjs": `import { log } from "tla/using.mjs";
${js}t("x", () => log);
`,
      "entry_tla.mjs": `${js}console.log("1");
queueMicrotask(() => console.log("microtask"));
setTimeout(() => console.log("timer"), 0);
await null;
console.log("2");
await new Promise((r) => setTimeout(r, 5));
console.log("3");
`,
      "cjs_imports.cjs": `${js}import("tla/parent.mjs").then(async (m) => { const { log } = await import("tla/log.mjs"); t("x", () => [m.all, log]); });
console.log("sync end");
`,
    },
  },
];
