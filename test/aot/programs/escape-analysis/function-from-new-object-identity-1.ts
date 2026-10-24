// A function taken from a freshly created object keeps its identity when it is forwarded, called by value, stored or put in a Set.
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R1 { a1: number; m1: () => number }
function make1(): R1 { return { a1: 1, m1: () => 1 }; }
function get1(): unknown { return make1().m1; }
function c1(): void { say("field-of-fresh", get1() === get1()); }

interface R2 { a2: number; m2: () => number }
function make2(): R2 { return { a2: 1, m2: () => 1 }; }
function get2a(): unknown { return make2().m2; }
function get2b(): unknown { return get2a(); }
function get2c(): unknown { return get2b(); }
function c2(): void { say("forwarded-twice", get2c() === get2c()); }

interface R3 { a3: number; m3: () => number }
interface O3 { inner3: R3; n3: number }
function make3(): O3 { return { inner3: { a3: 1, m3: () => 1 }, n3: 2 }; }
function get3(): unknown { return make3().inner3.m3; }
function c3(): void { say("depth-two", get3() === get3()); }

interface R4 { a4: number; m4: () => number }
function make4(): R4 { return { a4: 1, m4: () => 1 }; }
function get4(): unknown { return make4().m4; }
function c4(): void { const g = get4; say("called-by-value", g() === g()); }

interface R5 { a5: number; m5: () => number }
function make5(): R5 { return { a5: 1, m5: () => 1 }; }
class K5 { get(): unknown { return make5().m5; } }
function c5(): void { const k = new K5(); say("method", k.get() === k.get()); }

interface R6 { a6: number; m6: () => number }
function make6(): R6 { return { a6: 1, m6: () => 1 }; }
function get6(): unknown { return make6().m6; }
function c6(): void { say("set-size", new Set([get6(), get6()]).size); }

interface R7 { a7: number; m7: () => number }
function make7(): R7 { return { a7: 1, m7: () => 1 }; }
function get7(): any { return make7().m7; }
function c7(): void { get7().tag = 1; say("written", get7().tag); }

function list8(): Array<() => number> { return [() => 1]; }
function get8(): unknown { return list8()[0]; }
function c8(): void { say("element-of-fresh", get8() === get8()); }

interface R9 { a9: number; m9: () => number }
function make9(): R9 { return { a9: 1, m9: () => 1 }; }
function get9(): unknown { const { m9 } = make9(); return m9; }
function c9(): void { say("pattern", get9() === get9()); }

interface R10 { a10: number; m10: () => number }
function make10(): R10 { return { a10: 1, m10: () => 1 }; }
function with10<T>(k: (f: unknown) => T): T { return k(make10().m10); }
function c10(): void { say("through-a-callback", with10(x => x) === with10(x => x)); }

interface R11 { a11: number; m11: () => number }
function make11(): R11 { return { a11: 1, m11: () => 1 }; }
function get11(other: unknown, which: boolean): unknown { return which ? make11().m11 : other; }
function c11(): void { say("one-arm", get11(0, true) === get11(0, true)); }

interface R12 { a12: number; m12: () => number }
interface W12 { r12: R12 }
function wrap12(): W12 { return { r12: { a12: 1, m12: () => 1 } }; }
function rec12(): R12 { return wrap12().r12; }
function c12(): void { say("record-out-of-fresh", rec12().m12 === rec12().m12); }

interface R13 { a13: number; m13: () => number }
function make13(): R13 { return { a13: 1, m13: () => 1 }; }
function get13(): unknown { try { return make13().m13; } finally { out.length; } }
function c13(): void { say("try-finally", get13() === get13()); }

interface R14 { a14: number; m14: () => number }
function make14(): R14 { return { a14: 1, m14: () => 1 }; }
function get14(): { f: unknown } { return { f: make14().m14 }; }
function c14(): void { say("rewrapped", get14().f === get14().f); }

interface R15 { a15: number; m15: () => number }
function make15(): R15 { return { a15: 1, m15: () => 1 }; }
function get15(): unknown[] { return [make15().m15]; }
function c15(): void { say("rewrapped-in-an-array", get15()[0] === get15()[0]); }

interface R16 { a16: number; m16: () => number }
function make16(): R16 { return { a16: 1, m16: () => 1 }; }
function get16(): unknown { return make16().m16; }
const seen16 = new WeakSet<object>();
function c16(): void { seen16.add(get16() as object); say("weak-set", seen16.has(get16() as object)); }

interface R17 { a17: number; m17: () => number }
function make17(): R17 { return { a17: 1, m17: () => 1 }; }
function get17(): unknown { let r = make17(); for (let i = 0; i < 2; i++) r = make17(); return r.m17; }
function c17(): void { say("through-a-loop", get17() === get17()); }

interface R18 { a18: number; m18: () => number }
function make18(): R18 { return { a18: 1, m18: () => 1 }; }
function id18<T>(x: T): T { return x; }
function get18(): unknown { return id18(make18()).m18; }
function c18(): void { say("through-identity", get18() === get18()); }

interface R19 { a19: number; m19: () => number }
function make19(): R19 { return { a19: 1, m19: () => 1 }; }
function pick19(r: R19): unknown { return r.m19; }
function get19(): unknown { return pick19(make19()); }
function c19(): void { say("picked-by-a-callee", get19() === get19()); }

interface R20 { a20: number; m20: () => number }
function make20(): R20 { return { a20: 1, m20: () => 1 }; }
function get20(): () => unknown { const r = make20(); return () => r.m20; }
function c20(): void { say("out-of-a-captured-record", get20()() === get20()()); }

c1(); c2(); c3(); c4(); c5(); c6(); c7(); c8(); c9(); c10(); c11(); c12(); c13(); c14(); c15(); c16(); c17(); c18(); c19(); c20();
console.log(out.join("\n"));
