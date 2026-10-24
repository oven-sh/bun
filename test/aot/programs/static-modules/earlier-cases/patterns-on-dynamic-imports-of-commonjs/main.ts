// `const { default: d, a } = await import(..)` of CommonJS files.
// @ts-nocheck
declare const console: { log(...values: unknown[]): void };
const { default: d, a } = await import("./m.cjs");
console.log(a, d.a, d.b, typeof d);
const { default: own, a: ofMarked, __esModule: flag } = await import("./marked.cjs");
console.log(typeof own === "string" ? own : Object.keys(own).sort().join(), ofMarked, String(flag));
const { default: handed } = await import("./handed.cjs");
console.log(Object.keys(handed).join(), JSON.stringify(handed));
