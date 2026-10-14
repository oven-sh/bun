// `o.m(..)` written as `GetById` + `Call`: the TypeError names `m`, as that of a call by name does.
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
// Not here: a value that is a CELL and cannot be called (a string, a symbol, a bigint, a plain object): with up to as many arguments as there are registers the stub reports it, and knows no name: so it was for a call by name too.
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
