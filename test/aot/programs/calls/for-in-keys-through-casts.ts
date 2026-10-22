// Keys of a `for..in` loop that go through casts to boolean or number. A cast is a test and never a conversion: a key is a string, so the cast throws a TypeError, whether the compiler sees where the key comes from or not.
declare const console: any;
function any(x: unknown): any { return x }
function show(v: unknown): string { return typeof v + " " + (Object.is(v, -0) ? "-0" : String(v)) }
function failure(e: unknown): string { return "throws " + (e as Error).constructor.name }
const G: unknown[] = ((globalThis as any).G = [0]);
function hide(x: unknown): any { G[0] = x; return G[0] }
function own(o: any, key: string): boolean { return Object.hasOwn(o, key) }
function has(o: any, key: string): boolean { return o.hasOwnProperty(key) }
function read(o: any, key: string): unknown { return o[key] }
function isIn(o: any, key: string): boolean { return key in o }
function ownByBoolean(o: any): unknown { let s = ""; for (const k in o) s += own(o, k as any as boolean as any as string) + ";"; return s }
function ownByBooleanHidden(o: any): unknown { let s = ""; for (const k in o) s += own(o, hide(k) as any as boolean as any as string) + ";"; return s }
function hasByBoolean(o: any): unknown { let s = ""; for (const k in o) s += has(o, k as any as boolean as any as string) + ";"; return s }
function hasByBooleanHidden(o: any): unknown { let s = ""; for (const k in o) s += has(o, hide(k) as any as boolean as any as string) + ";"; return s }
function readByBoolean(o: any): unknown { let s = ""; for (const k in o) s += show(read(o, k as any as boolean as any as string)) + ";"; return s }
function readByBooleanHidden(o: any): unknown { let s = ""; for (const k in o) s += show(read(o, hide(k) as any as boolean as any as string)) + ";"; return s }
function isInByBoolean(o: any): unknown { let s = ""; for (const k in o) s += isIn(o, k as any as boolean as any as string) + ";"; return s }
function isInByBooleanHidden(o: any): unknown { let s = ""; for (const k in o) s += isIn(o, hide(k) as any as boolean as any as string) + ";"; return s }
function ownByNumber(o: any): unknown { let s = ""; for (const k in o) s += own(o, k as any as number as any as string) + ";"; return s }
function ownByNumberHidden(o: any): unknown { let s = ""; for (const k in o) s += own(o, hide(k) as any as number as any as string) + ";"; return s }
function hasByNumber(o: any): unknown { let s = ""; for (const k in o) s += has(o, k as any as number as any as string) + ";"; return s }
function hasByNumberHidden(o: any): unknown { let s = ""; for (const k in o) s += has(o, hide(k) as any as number as any as string) + ";"; return s }
function readThenOwnByBoolean(o: any): unknown { let s = ""; for (const k in o) { const x = o[k]; s += show(x) + "," + own(o, k as any as boolean as any as string) + ";" }; return s }
function readThenOwnByBooleanHidden(o: any): unknown { let s = ""; for (const k in o) { const x = o[k]; s += show(x) + "," + own(o, hide(k) as any as boolean as any as string) + ";" }; return s }
function readThenHasByBoolean(o: any): unknown { let s = ""; for (const k in o) { const x = o[k]; s += show(x) + "," + has(o, k as any as boolean as any as string) + ";" }; return s }
function readThenHasByBooleanHidden(o: any): unknown { let s = ""; for (const k in o) { const x = o[k]; s += show(x) + "," + has(o, hide(k) as any as boolean as any as string) + ";" }; return s }
function ownThenOwnByBoolean(o: any): unknown { let s = ""; for (const k in o) { if (own(o, k)) s += own(o, k as any as boolean as any as string) + ";" }; return s }
function ownThenOwnByBooleanHidden(o: any): unknown { let s = ""; for (const k in o) { if (own(o, k)) s += own(o, hide(k) as any as boolean as any as string) + ";" }; return s }
function hasThenHasByBoolean(o: any): unknown { let s = ""; for (const k in o) { if (has(o, k)) s += has(o, k as any as boolean as any as string) + ";" }; return s }
function hasThenHasByBooleanHidden(o: any): unknown { let s = ""; for (const k in o) { if (has(o, k)) s += has(o, hide(k) as any as boolean as any as string) + ";" }; return s }
function hasThenReadByBoolean(o: any): unknown { let s = ""; for (const k in o) { if (has(o, k)) s += show(read(o, k as any as boolean as any as string)) + ";" }; return s }
function hasThenReadByBooleanHidden(o: any): unknown { let s = ""; for (const k in o) { if (has(o, k)) s += show(read(o, hide(k) as any as boolean as any as string)) + ";" }; return s }
function ownHonest(o: any): unknown { let s = ""; for (const k in o) s += own(o, k as any as string) + ";"; return s }
function ownHonestHidden(o: any): unknown { let s = ""; for (const k in o) s += own(o, hide(k) as any as string) + ";"; return s }
function hasHonest(o: any): unknown { let s = ""; for (const k in o) s += has(o, k) + ";"; return s }
function hasHonestHidden(o: any): unknown { let s = ""; for (const k in o) s += has(o, hide(k)) + ";"; return s }
const inSight: ((...a: any[]) => unknown)[] = [ownByBoolean, hasByBoolean, readByBoolean, isInByBoolean, ownByNumber, hasByNumber, readThenOwnByBoolean, readThenHasByBoolean, ownThenOwnByBoolean, hasThenHasByBoolean, hasThenReadByBoolean, ownHonest, hasHonest];
const hidden: ((...a: any[]) => unknown)[] = [ownByBooleanHidden, hasByBooleanHidden, readByBooleanHidden, isInByBooleanHidden, ownByNumberHidden, hasByNumberHidden, readThenOwnByBooleanHidden, readThenHasByBooleanHidden, ownThenOwnByBooleanHidden, hasThenHasByBooleanHidden, hasThenReadByBooleanHidden, ownHonestHidden, hasHonestHidden];
const names = ["ownByBoolean", "hasByBoolean", "readByBoolean", "isInByBoolean", "ownByNumber", "hasByNumber", "readThenOwnByBoolean", "readThenHasByBoolean", "ownThenOwnByBoolean", "hasThenHasByBoolean", "hasThenReadByBoolean", "ownHonest", "hasHonest"];
const given: (() => any[])[] = [() => [{ a: 1, b: 2 }], () => [{ a: 1, b: 2, NaN: 3, true: 4 }], () => [{ 1: 10, a: 1, b: 2 }], () => [JSON.parse('{"a":1,"b":2}')], () => [JSON.parse('{"b":2,"a":1,"NaN":3,"true":4}')]];
const said = ["{ a: 1, b: 2 }", "{ a: 1, b: 2, NaN: 3, true: 4 }", "{ 1: 10, a: 1, b: 2 }", "JSON.parse('{\"a\":1,\"b\":2}')", "JSON.parse('{\"b\":2,\"a\":1,\"NaN\":3,\"true\":4}')"];
let a = "", b = "";
for (let turn = 0; turn < 3; turn++) {
  for (let i = 0; i < names.length; i++) {
    for (let j = 0; j < given.length; j++) {
      try { a = show(inSight[i](...given[j]())) } catch (e) { a = failure(e) }
      try { b = show(hidden[i](...given[j]())) } catch (e) { b = failure(e) }
      console.log(names[i] + " " + said[j] + ": " + (a === b ? "same: " + a : "DIFFERS: in sight: " + a + " | hidden: " + b));
    }
  }
}
