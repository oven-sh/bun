// The TypeError for calling `o.m(..)` when `m` is not a function names `m`.
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
// Not tested here: a value that is a CELL and cannot be called (a string, a symbol, a bigint, a plain object). With no more arguments than there are registers the stub reports it and does not know the name, as for a call by name.
const values: any[] = ["keep", 5, undefined, null, true, 1.5];
for (let round = 0; round < 2; round++) {
  for (const v of values) {
    const out: string[] = [];
    for (const run of [() => m.callOnNew(v), () => { const o = new m.Holder(); if (v !== "keep") o.distinctiveName = v; return m.callIt(o); }, () => { const o = new m.Holder(); if (v !== "keep") o.distinctiveName = v; return m.callItWithMany(o); }, () => m.callIt({ distinctiveName: v === "keep" ? (x: any) => x : v })]) {
      try { out.push(String(run())); } catch (e: any) { out.push(e.constructor.name + (String(e.message).includes("distinctiveName") ? " names it" : " DOES NOT NAME IT")); }
    }
    console.log(String(v) + ": " + out.join(" | "));
  }
}
for (const o of [undefined, null]) { try { m.callIt(o); } catch (e: any) { console.log(e.constructor.name, String(e.message).includes("distinctiveName")); } }
export {};
