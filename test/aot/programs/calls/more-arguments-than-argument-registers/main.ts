// Calls with more arguments than there are argument registers (8 on ARM64, 4 on x86-64).
// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
const S = (v: any) => String(v);
const callees: [string, any][] = [
  ["fixed12", function (this: any, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any, j: any, k: any, l: any) { return S(this) + "/" + [a, b, c, d, e, f, g, h, i, j, k, l].map(S).join(); }],
  ["fixed9", function (this: any, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any) { return S(this) + "/" + [a, b, c, d, e, f, g, h, i].map(S).join(); }],
  ["fixed8", function (this: any, a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any) { return S(this) + "/" + [a, b, c, d, e, f, g, h].map(S).join(); }],
  ["fixed2", function (this: any, a: any, b: any) { return S(this) + "/" + S(a) + S(b); }], ["fixed0", function (this: any) { return S(this) + "/none"; }],
  ["rest", function (this: any, ...r: any[]) { return S(this) + "/" + r.length + ":" + r.map(S).join(); }], ["restAfter2", function (a: any, b: any, ...r: any[]) { return S(a) + S(b) + "/" + r.map(S).join(); }],
  ["arguments", function (this: any) { return arguments.length + ":" + Array.prototype.join.call(arguments); }], ["arrow", (...r: any[]) => r.length + ":" + r[8]],
  ["withProperty", Object.assign(function (...r: any[]) { return "p" + r.length; }, { extra: 1 })], ["max", Math.max], ["bound", function (this: any, ...r: any[]) { return S(this) + r.join(""); }.bind("B", "b")],
  ["async", async function (...r: any[]) { return r.length; }], ["class", class K {}], ["proxy", new Proxy(function (...r: any[]) { return "x" + r.length; }, {})], ["thrower", function (...r: any[]) { throw new RangeError("r"); }],
  ["object", {}], ["undefined", undefined], ["number", 5]];
for (let round = 0; round < 2; round++) {
  for (const [name, f] of callees) {
    const out: string[] = [];
    for (const run of [() => m.call8(f), () => m.call9(f), () => m.call10(f), () => m.call12(f, { toString() { return "o"; } }), () => m.method9({ m: f, toString() { return "recv"; } }), () => m.method12({ m: f, toString() { return "recv"; } }, "x"),
      () => m.dotCall10(f, "T"), () => m.nested9(f), () => m.inHandler9(f)]) { try { const r = run(); out.push(name === "async" ? typeof r : S(r)); } catch (e: any) { out.push("threw " + e.constructor.name); } }
    console.log(name + ": " + out.join(" | "));
  }
}
try { m.method9({}); } catch (e: any) { console.log(e.constructor.name); } try { m.method9(null); } catch (e: any) { console.log(e.constructor.name); }
// Deep recursion through such calls ends in a RangeError, not in a crash.
{ const deep: any = function (a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any, i: any): any { return deep(a + 1, b, c, d, e, f, g, h, i) + 1; }; try { m.call9(deep); } catch (e: any) { console.log(e.constructor.name); } }
export {};
