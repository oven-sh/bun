// What the inlined first test of a function reads through a type that admits objects from outside stands behind a test that the object is
// one of the program's: so it has the type the property is declared with, also where the value is only asked whether it is truthy.
// IR+ TypeTest v[0-9]+ testedType=L[0-9]+!
// IR- ~number = PropGet .*#[0-9]+$
// IR+ : number = PropGet v[0-9]+ name="id" .*#[0-9]+$
declare const console: { log(...values: unknown[]): void };
const JSON = { parse(text: string): any { const parsed = globalThis.JSON.parse(text); for (let o = parsed; o; o = o.cached) if (!("cached" in o)) o.cached = undefined; return parsed; } };
const log: string[] = [];
function pad(x: number): number { let s = 0; for (let i = 0; i < 3; i++) { s += x + i; s ^= i; s += x * 2; s -= i; s |= 0; s += 7; s ^= x; s += 11; s -= 3; s += x & 5; s ^= 9; s += 13; s -= x >> 1; s ^= 21; s += x * 3; s -= 5; s |= 0 } return s }
interface Kind { flags: number; cached: Kind | undefined; id: number }
const fromOutside = JSON.parse('{"flags":1,"id":40}') as Kind;
let made = 0;
function reduced(t: Kind): Kind { if (!(t.flags & 4)) return t; return t.cached || (t.cached = { flags: t.flags & ~4, cached: undefined, id: ++made + pad(t.id) * 0 + pad(1) * 0 + pad(2) * 0 }) }
function idOf(t: Kind | undefined): number { if (!t) return -1; if (t.id) return t.id; log.push("i"); t.id = ++made; return t.id + pad(1) * 0 + pad(2) * 0 + pad(3) * 0 }
function twoDeep(t: Kind): number { if (t.cached && t.cached.flags & 1) return t.cached.id; log.push("d"); return pad(4) * 0 + pad(5) * 0 + pad(6) * 0 - 1 }
let reads = 0;
const withGetter: any = { get flags() { reads++; return 1 }, get id() { reads += 10; return 50 }, cached: undefined };
const withGetterThatThrows: any = { get flags() { throw new RangeError("flags") }, id: 0, cached: undefined };
function attempt(f: () => unknown): unknown { try { return f() } catch (e: any) { return e.constructor.name } }
function forwards(list: Kind[]): number { let sum = 0; for (let i = 0; i < list.length; i++) { const t = list[i]; sum += reduced(t).id + idOf(t) + twoDeep(t); sum |= 0 } return sum }
function backwards(list: Kind[]): number { let sum = 0; for (let i = list.length; i--;) { const t = list[i]; sum += twoDeep(t) + idOf(t) + reduced(t).id; sum |= 0 } return sum }
function everyOther(list: Kind[]): number { let sum = 0; for (let i = 0; i < list.length; i += 2) { const t = list[i]; sum += idOf(reduced(t)) + twoDeep(reduced(t)); sum |= 0 } return sum }
function pairs(list: Kind[]): number { let sum = 0; for (let i = 1; i < list.length; i++) { sum += idOf(list[i - 1]) + idOf(list[i]) + twoDeep(list[i]) + reduced(list[i - 1]).flags; sum |= 0 } return sum }
function sweep(list: Kind[], rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum = (sum + forwards(list) + backwards(list) + everyOther(list) + pairs(list)) | 0;
  return sum;
}
const plain: Kind = { flags: 1, cached: undefined, id: 3 }, union: Kind = { flags: 5, cached: undefined, id: 7 }, holder: Kind = { flags: 0, cached: plain, id: 0 };
console.log(sweep([plain, union, holder], 200), made, log.length);
console.log(sweep([plain, fromOutside, union, fromOutside], 200), made, log.length);
log.length = 0;
console.log(sweep([withGetter as Kind], 5), reads, log.join(""));
console.log(attempt(() => sweep([plain, withGetterThatThrows as Kind], 2)), attempt(() => sweep([plain, undefined as unknown as Kind], 2)), attempt(() => sweep([null as unknown as Kind], 2)));
console.log(sweep([JSON.parse('{"flags":4,"id":9}') as Kind, JSON.parse('{"flags":0,"id":0,"cached":{"flags":1,"id":77}}') as Kind], 3), made, log.join(""));
export {};
