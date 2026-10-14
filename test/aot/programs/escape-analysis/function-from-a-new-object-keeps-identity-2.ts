// A function taken from a freshly created object keeps its identity through captures, accessors, spread calls, rest parameters and `arguments`.
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R1 { a1: number; m1: () => number }
function make1(): R1 { return { a1: 1, m1: () => 1 }; }
function get1(): () => unknown { const f = make1().m1; return () => f; }
function c1(): void { say("captured-content", get1()() === get1()()); }

interface R2 { a2: number; m2: () => number }
function make2(): R2 { return { a2: 1, m2: () => 1 }; }
function box2(f: unknown): { f: unknown } { return { f }; }
function get2(): { f: unknown } { return box2(make2().m2); }
function c2(): void { say("boxed-by-a-callee", get2().f === get2().f); }

interface R3 { a3: number; m3: () => number }
function make3(): R3 { return { a3: 1, m3: () => 1 }; }
function same3(a: unknown, b: unknown): boolean { return a === b; }
function c3(): void { say("same-in-a-callee", same3(make3().m3, make3().m3)); }

interface R4 { a4: number; m4: () => number }
function make4(): R4 { return { a4: 1, m4: () => 1 }; }
class K4 { get f(): unknown { return make4().m4; } }
function c4(): void { const k = new K4(); say("accessor", k.f === k.f); }

interface R5 { a5: number; m5: () => number }
function make5(): R5 { return { a5: 1, m5: () => 1 }; }
function pick5(...xs: unknown[]): unknown { return xs[0]; }
function c5(): void { say("spread-call", pick5(...[make5().m5]) === pick5(...[make5().m5])); }

interface R6 { a6: number; m6: () => number }
function make6(): R6 { return { a6: 1, m6: () => 1 }; }
function pick6(...xs: unknown[]): unknown { return xs[0]; }
function c6(): void { say("rest", pick6(make6().m6) === pick6(make6().m6)); }

interface R7 { a7: number; m7: () => number }
function make7(): R7 { return { a7: 1, m7: () => 1 }; }
function pick7(this: unknown, _x: unknown): unknown { return arguments[0]; }
function c7(): void { say("arguments", pick7(make7().m7) === pick7(make7().m7)); }

interface R8 { a8: number; m8: () => number }
function make8(): R8 { return { a8: 1, m8: () => 1 }; }
function c8(): void { let last: unknown, same = false; for (const f of [make8().m8, make8().m8]) { same = f === last; last = f; } say("for-of", same); }

interface R9 { a9: number; m9: () => number }
function make9(): R9 { return { a9: 1, m9: () => 1 }; }
function c9(): void { const m = new Map<number, unknown>(); m.set(1, make9().m9); m.set(2, make9().m9); say("map-value", m.get(1) === m.get(2)); }

interface R10 { a10: number; m10: () => number }
function make10(): R10 { return { a10: 1, m10: () => 1 }; }
function c10(): void { const m = new Map<unknown, number>(); m.set(make10().m10, 1); m.set(make10().m10, 2); say("map-key", m.size); }

interface R11 { a11: number; m11: () => number }
function make11(): R11 { return { a11: 1, m11: () => 1 }; }
function c11(): void { say("object-values", Object.values(make11())[1] === Object.values(make11())[1]); }

interface R12 { a12: number; m12: () => number }
function make12(): R12 { return { a12: 1, m12: () => 1 }; }
function c12(): void { say("object-entries", Object.entries(make12())[1][1] === Object.entries(make12())[1][1]); }

interface R13 { a13: number; m13: () => number }
function make13(): R13 { return { a13: 1, m13: () => 1 }; }
function c13(): void { say("spread-copy", { ...make13() }.m13 === { ...make13() }.m13); }

interface R14 { a14: number; m14: () => number }
function make14(): R14 { return { a14: 1, m14: () => 1 }; }
function c14(): void { say("assign-copy", Object.assign({}, make14()).m14 === Object.assign({}, make14()).m14); }

interface R15 { a15: number; m15: () => number }
function make15(): R15 { return { a15: 1, m15: () => 1 }; }
class C15 { r = make15(); }
function c15(): void { say("class-field", new C15().r.m15 === new C15().r.m15); }

interface R16 { a16: number; m16: () => number }
function make16(): R16 { return { a16: 1, m16: () => 1 }; }
function c16(): void { const f = make16().m16, g = make16().m16; let hit = false; switch (f) { case g: hit = true; } say("switch", hit); }

interface R17 { a17: number; m17: () => number }
function make17(): R17 { return { a17: 1, m17: () => 1 }; }
function c17(): void { say("includes", [make17().m17].includes(make17().m17)); }

interface R18 { a18: number; m18: () => number }
function make18(): R18 { return { a18: 1, m18: () => 1 }; }
function c18(): void { say("index-of", [make18().m18].indexOf(make18().m18)); }

interface R19 { a19: number; m19: () => number }
function make19(): R19 { return { a19: 1, m19: () => 1 }; }
function c19(): void { say("object-is", Object.is(make19().m19, make19().m19)); }

interface R20 { a20: number; m20: () => number }
function make20(): R20 { return { a20: 1, m20: () => 1 }; }
function c20(): void { const a = make20(), b = make20(); const f = out.length >= 0 ? a.m20 : b.m20; say("conditional", f === b.m20); }

interface R21 { a21: number; m21: () => number }
function make21(): R21 { return { a21: 1, m21: () => 1 }; }
function c21(): void { const k: string = "m21"; say("by-key", (make21() as any)[k] === (make21() as any)[k]); }

interface R22 { a22: number; m22: () => number }
function make22(): R22 { return { a22: 1, m22: () => 1 }; }
function c22(): void { (globalThis as any).g22 = make22().m22; say("global-this", (globalThis as any).g22 === make22().m22); }

interface R23 { a23: number; m23: () => number }
function make23(): R23 { return { a23: 1, m23: () => 1 }; }
function all23(): R23[] { return [make23(), make23()]; }
function c23(): void { const xs = all23(); say("array-of-records", xs[0].m23 === xs[1].m23); }

interface R24 { a24: number; m24: () => number }
function make24(): R24 { return { a24: 1, m24: () => 1 }; }
let kept24: R24 | undefined;
function keep24(): void { kept24 = make24(); }
function c24(): void { keep24(); const first = kept24!.m24; keep24(); say("record-in-a-variable", first === kept24!.m24); }

interface R25 { a25: number; m25: () => number }
function make25(): R25 { return { a25: 1, m25: () => 1 }; }
function other25(): R25 { return { a25: 2, m25: () => 2 }; }
function c25(): void { say("two-makers-one-type", make25().m25 === make25().m25 || other25().m25 === other25().m25); }

interface R26 { a26: number; m26: () => number }
function make26(): R26 { return { a26: 1, m26: () => 1 }; }
function c26(): void { (make26().m26 as any).tag = 1; say("written-through-the-record", (make26().m26 as any).tag); }

interface R27 { a27: number; m27: () => number }
function make27(): R27 { return { a27: 1, m27: () => 1 }; }
function c27(): void { const w = new WeakRef(make27().m27); say("weak-ref", w.deref() === make27().m27); }

interface R28 { a28: number; m28: () => number }
function make28(): R28 { return { a28: 1, m28: () => 1 }; }
function c28(): void { const xs = [make28().m28, make28().m28]; say("sort-stable", new Set(xs.slice().reverse()).size); }

interface RP { ap: number; fp: () => void }
function makeP(): RP { return { ap: 1, fp: function () {} }; }
function cP(): void { say("prototype-of-a-function-expression", (makeP().fp as any).prototype === (makeP().fp as any).prototype); }

interface RN { an: number; fn: () => void }
function makeN(): RN { return { an: 1, fn: function () {} }; }
function cN(): void { const F = makeN().fn as any, G = makeN().fn as any; say("instance-of", new F() instanceof G); }

interface RY { ay: number; my: () => number }
function makeY(): RY { return { ay: 1, my: () => 1 }; }
function* genY(): Generator<unknown> { yield makeY().my; yield makeY().my; }
function cY(): void { const [a, b] = [...genY()]; say("generator", a === b); }

interface RZ { az: number; mz: () => number }
function makeZ(): RZ { return { az: 1, mz: () => 1 }; }
async function getZ(): Promise<unknown> { return makeZ().mz; }
async function cZ(): Promise<void> { say("async", (await getZ()) === (await getZ())); }

interface RT { at: number; mt: () => number }
function makeT(): RT { return { at: 1, mt: () => 1 }; }
async function cT(): Promise<void> { let last: unknown; await Promise.resolve(makeT().mt).then(f => { last = f; }); await Promise.resolve(makeT().mt).then(f => { say("then", f === last); }); }

c1(); c2(); c3(); c4(); c5(); c6(); c7(); c8(); c9(); c10(); c11(); c12(); c13(); c14(); c15(); c16(); c17(); c18(); c19(); c20(); c21(); c22(); c23(); c24(); c25(); c26(); c27(); c28(); cP(); cN(); cY();
cZ().then(() => cT()).then(() => console.log(out.join("\n")));
