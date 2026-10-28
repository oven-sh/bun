// A function whose first test is inlined into hot callers reads a property of an object of the program. The property was stored to
// through a wider type, so it holds a string where the narrower type declares a number. The store succeeds, a read through the wider type gives the string,
// and the typed read through the narrower type throws a TypeError at every call alike, inlined or not.
// IR+ TypeTest v[0-9]+ testedType=L[0-9]+!
declare const console: { log(...values: unknown[]): void };
const JSON = { parse(text: string): any { const parsed = globalThis.JSON.parse(text); for (let o = parsed; o; o = o.cached) if (!("cached" in o)) o.cached = undefined; return parsed; } };
const log: string[] = [];
function pad(x: number): number { let s = 0; for (let i = 0; i < 3; i++) { s += x + i; s ^= i; s += x * 2; s -= i; s |= 0; s += 7; s ^= x; s += 11; s -= 3; s += x & 5; s ^= 9; s += 13; s -= x >> 1; s |= 0 } return s }
interface Kind { flags: number; cached: Kind | undefined; id: number }
interface Wide { flags: number; cached: Kind | undefined; id: number | string }
const fromOutside = JSON.parse('{"flags":1,"id":40}') as Kind;
function hasId(t: Kind | undefined): number { if (!t) return -1; if (t.id) return 1; log.push("i"); return pad(1) * 0 + pad(2) * 0 + pad(3) * 0 + pad(4) * 0 + pad(5) * 0 + pad(6) * 0 }
function attempt(f: () => unknown): unknown { try { return f() } catch (e: any) { return e.constructor.name } }
function forwards(list: Kind[]): number { let sum = 0; for (let i = 0; i < list.length; i++) { const t = list[i]; sum += hasId(t); sum |= 0 } return sum }
function backwards(list: Kind[]): number { let sum = 0; for (let i = list.length; i--;) { const t = list[i]; sum += hasId(t); sum |= 0 } return sum }
function everyOther(list: Kind[]): number { let sum = 0; for (let i = 0; i < list.length; i += 2) { const t = list[i]; sum += hasId(t) + hasId(t.cached); sum |= 0 } return sum }
function pairs(list: Kind[]): number { let sum = 0; for (let i = 1; i < list.length; i++) { sum += hasId(list[i - 1]) + hasId(list[i]); sum |= 0 } return sum }
function sweep(list: Kind[], rounds: number): number {
  let sum = 0;
  for (let round = 0; round < rounds; round++) sum = (sum + forwards(list) + backwards(list) + everyOther(list) + pairs(list)) | 0;
  return sum;
}
function widen(w: Wide, text: string): void { w.id = text }
const plain: Kind = { flags: 1, cached: undefined, id: 3 }, other: Kind = { flags: 5, cached: plain, id: 0 };
const list: Kind[] = [plain, other, fromOutside];
console.log(attempt(() => sweep(list, 100)), log.length);
widen(plain, "text");
console.log(attempt(() => sweep(list, 100)), log.length);
widen(other, "");
console.log(attempt(() => sweep(list, 100)), log.length);
console.log(attempt(() => hasId(plain)), attempt(() => hasId(other)), typeof (plain as Wide).id);
