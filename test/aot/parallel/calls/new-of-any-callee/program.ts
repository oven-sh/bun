// @ts-ignore
import untyped from "./untyped.js";
declare const console: any;
const m: any = untyped;
function TypedThis(this: { v: any }, v?: any) { this.v = v; }
class TypedClass { constructor(public v?: any) {} get twice() { return this.v * 2; } }
class TypedDerived extends TypedClass { w = 1; }
const callees: any = { ...m.callees, TypedThis, TypedClass, TypedDerived };
const describe = (o: any) => { if (o === null || (typeof o !== "object" && typeof o !== "function")) return String(o); const p = Object.getPrototypeOf(o);
  let text: string; try { text = JSON.stringify(o); } catch { text = "?"; }
  return typeof o + " " + text + " " + (p === null ? "null" : p === Object.prototype ? "Object.prototype" : p.marker ?? p.constructor?.name); };
for (let round = 0; round < 2; round++) {
  for (const name of Object.keys(callees)) {
    const F = callees[name]; const out: string[] = [];
    for (const make of [() => m.new0(F), () => m.new1(F, 1), () => m.new1(F, 2), () => m.new1(F, 3), () => m.new3(F, 1, 2, 3), () => m.new9(F), () => m.newSpread(F, []), () => m.newSpread(F, [1, 2]), () => m.newSpread(F, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10])]) {
      try { const o = make(); out.push(name === "Date" || name === "Promise" || name === "Error" ? typeof o : describe(o)); } catch (e: any) { out.push("threw " + e.constructor.name + (String(e.message).startsWith("from") ? " " + e.message : "")); }
    }
    console.log(name + ": " + out.join(" | "));
  }
}
// instanceof, constructor, and a prototype exchanged between two constructions through the same site.
{ const F = callees.P2; const a = m.new1(F, 1); const old = F.prototype; F.prototype = { marker: "second" }; const b = m.new1(F, 1); F.prototype = old; const c = m.new1(F, 1);
  console.log(a instanceof F, Object.getPrototypeOf(b).marker, c instanceof F, a.constructor === F, Object.getPrototypeOf(a) === Object.getPrototypeOf(c)); }
{ const A = callees.Capturing1, B = callees.Capturing2; console.log(m.new1(A, 1) instanceof A, m.new1(A, 1) instanceof B, m.new1(B, 1).sum); }
export {};
