class Whole { size = 3; }
class Half { size = 0.5; }
type Piece = Whole | Half;
class Tag { n = 1; m = 2; }
const unseen = (x: any): any => [x][JSON.parse("0")];
const unit = new Whole(), half = new Half();
function sizeOf(piece: Piece): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return piece.size * 2 + work; }
const shown: any = unseen(5), text: any = unseen("a text of some length"), key: any = unseen("p"), sym: any = Symbol.iterator, big: any = unseen(10n);
let counter: any = 0;
function show(x: any, depth = 0): string {
  if (typeof x === "number") return Object.is(x, -0) ? "-0" : String(x);
  if (typeof x === "bigint") return x + "n";
  if (typeof x === "symbol") return "sym";
  if (typeof x === "function") return "fn";
  if (typeof x === "string") return JSON.stringify(x);
  if (x === null || typeof x !== "object") return String(x);
  if (depth > 2) return "..";
  return Array.isArray(x) ? "[" + x.map((e) => show(e, depth + 1)).join() + "]" : "{" + Object.keys(x).map((k) => k + ":" + show(x[k], depth + 1)).join() + "}";
}
const makeOther = (): any => unseen({ p: 11, q: "q", 0: "zero", gone: 1, method(v: number) { return v + 1; } });
function main() {
  function pick(ratio: number, steps: number): number { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return ratio * 100 + steps + work; }
  function mixed(ratio: number, steps: number, any: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return [ratio, steps, any, work]; }
  function callee(any: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + i) | 0; return [any, work]; }
  function probe0(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; const next = other?.[0]; return [next, held]; }
  function probe1(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; const next = value?.length; return [next, held]; }
  function probe2(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; const next = void value; return [next, held]; }
  function probe3(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; const next = (work, value); return [next, held]; }
  function probe4(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; const next = unit.size; return [next, held]; }
  function probe5(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; const next = half.size; return [next, held]; }
  function probe6(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; const next = unit.size + half.size; return [next, held]; }
  function probe7(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; const next = held; return [next, held]; }
  function probe8(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; const next = held === null; return [next, held]; }
  function probe9(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; const next = typeof held; return [next, held]; }
  function probe10(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; const next = held ?? value; return [next, held]; }
  function probe11(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; let next: any = 0; for (let i = 0; i < 3; i++) next += i; return [next, held, work]; }
  function probe12(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; let next: any = 0; for (let i = 0; i < 3; i++) { const was = next; next = work + i; work = was | 0; } return [next, held, work]; }
  function probe13(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; let next: any = 0; switch (value) { case 1: next = "one"; break; case "text": next = "t"; break; default: next = "d"; } return [next, held, work]; }
  function probe14(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; let next: any = 0; switch (work & 3) { case 0: next = shown; break; case 1: next = text; break; case 2: next = value; break; default: next = held; } return [next, held, work]; }
  function probe15(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; let next: any = 0; try { if (value === 7) throw value; next = 1; } catch (e) { next = [e]; } return [next, held, work]; }
  function probe16(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; let next: any = 0; try { next = other.p; } finally { counter = work; } return [next, held, work]; }
  function probe17(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; let next: any = 0; try { next = value.deep.deeper; } catch (e) { next = "caught"; } return [next, held, work]; }
  function probe18(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; let next: any = 0; if (value) next = shown; else next = text; return [next, held, work]; }
  function probe19(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; let next: any = 0; if (typeof value === "number") next = value + 1; else if (typeof value === "string") next = value + "!"; return [next, held, work]; }
  function probe20(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; let next: any = 0; const { p, q } = other; next = [p, q]; return [next, held, work]; }
  function probe21(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; let next: any = 0; let a: any = work, b: any = value; for (let i = 0; i < 3; i++) { const t = a; a = b; b = t; } next = [a, b]; return [next, held, work]; }
  function probe22(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; let next: any = 0; let a: any = shown, b: any = text; a = null; next = b; b = undefined; return [next, held, work]; }
  function probe23(tag: Tag, value: any, other: any): any { let work = 0; for (let i = 0; i < 2; i++) work = (work + tag.n + tag.m) | 0; let held: any = tag.n < work; held = null; let next: any = 0; while (next < 3) { next++; if (value === next) break; } return [next, held, work]; }
  const real = new Tag(), liar = unseen({ n: 1, m: 2 }), values: any[] = ["text", 7, 0, -0, 1.5, null, undefined, true, false, "", sym, big].map(unseen);
  { for (let turn = 0; turn < 300; turn++) probe0(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe0(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe0(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("0", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe1(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe1(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe1(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("1", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe2(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe2(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe2(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("2", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe3(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe3(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe3(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("3", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe4(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe4(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe4(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("4", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe5(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe5(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe5(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("5", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe6(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe6(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe6(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("6", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe7(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe7(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe7(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("7", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe8(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe8(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe8(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("8", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe9(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe9(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe9(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("9", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe10(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe10(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe10(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("10", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe11(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe11(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe11(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("11", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe12(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe12(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe12(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("12", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe13(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe13(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe13(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("13", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe14(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe14(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe14(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("14", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe15(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe15(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe15(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("15", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe16(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe16(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe16(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("16", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe17(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe17(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe17(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("17", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe18(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe18(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe18(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("18", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe19(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe19(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe19(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("19", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe20(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe20(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe20(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("20", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe21(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe21(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe21(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("21", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe22(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe22(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe22(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("22", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
  { for (let turn = 0; turn < 300; turn++) probe23(real, values[turn % values.length], makeOther());
    let fast = "", slow = ""; for (const value of values) { counter = 0; try { fast += show(probe23(real, value, makeOther())) + ";"; } catch (e: any) { fast += "!" + e.name + ";"; } counter = 0; try { slow += show(probe23(liar, value, makeOther())) + ";"; } catch (e: any) { slow += "!" + e.name + ";"; } }
    console.log("23", fast === slow ? "alike" : "FAST AND SLOW DIFFER", slow); }
}
console.log(sizeOf(unit), sizeOf(half));
main();
export {};
