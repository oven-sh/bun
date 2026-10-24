// import() of CommonJS files whose names are stored once, at the top.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
console.log("start");
const ns = await import("./settled.cjs");
const { a, f: renamed } = await import("./settled.cjs");
console.log(ns.a, ns.f(1), a, renamed(2), (await import("./marked.cjs")).default, (await import("./marked.cjs")).named);
async function later() { const m = await import("./marked.cjs"); return m.named + m.default; }
console.log(await later());
