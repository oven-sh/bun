// A function taken from a freshly created object keeps its identity through `Object.values`, `Object.entries`, `Reflect.apply` and property descriptors.
declare const console: any;
declare function structuredClone(x: unknown): unknown;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R1 { a1: number; m1: () => number }
function make1(): R1 { return { a1: 1, m1: () => 1 }; }
function c1(): void { say("values", Object.values(make1())[1] === Object.values(make1())[1]); }

interface R2 { a2: number; m2: () => number }
function make2(): R2 { return { a2: 1, m2: () => 1 }; }
function c2(): void { say("entries", Object.entries(make2())[1][1] === Object.entries(make2())[1][1]); }

interface R3 { a3: number; m3: () => number }
function make3(): R3 { return { a3: 1, m3: () => 1 }; }
const values3 = Object.values;
function c3(): void { say("alias-of-values", values3(make3())[1] === values3(make3())[1]); }

interface R4 { a4: number; m4: () => number }
function make4(): R4 { return { a4: 1, m4: () => 1 }; }
function c4(): void { say("values-call", Object.values.call(null, make4())[1] === Object.values.call(null, make4())[1]); }

interface R5 { a5: number; m5: () => number }
function make5(): R5 { return { a5: 1, m5: () => 1 }; }
function c5(): void { say("reflect-apply", (Reflect.apply(Object.values, null, [make5()]) as unknown[])[1] === (Reflect.apply(Object.values, null, [make5()]) as unknown[])[1]); }

interface R6 { a6: number; m6: () => number }
function make6(): R6 { return { a6: 1, m6: () => 1 }; }
function c6(): void { say("descriptor", Object.getOwnPropertyDescriptor(make6(), "m6")!.value === Object.getOwnPropertyDescriptor(make6(), "m6")!.value); }

interface R7 { a7: number; m7: () => number }
function make7(): R7 { return { a7: 1, m7: () => 1 }; }
function c7(): void { say("descriptors", (Object.getOwnPropertyDescriptors(make7()) as any).m7.value === (Object.getOwnPropertyDescriptors(make7()) as any).m7.value); }

interface R8 { a8: number; m8: () => number }
function make8(): R8 { return { a8: 1, m8: () => 1 }; }
function c8(): void { say("reflect-get", Reflect.get(make8(), "m8") === Reflect.get(make8(), "m8")); }

interface R9 { a9: number; m9: () => number }
function make9(): R9 { return { a9: 1, m9: () => 1 }; }
function c9(): void { say("from-entries", Object.fromEntries(Object.entries(make9())).m9 === Object.fromEntries(Object.entries(make9())).m9); }

interface R10 { a10: number; m10: () => number }
function make10(): R10 { return { a10: 1, m10: () => 1 }; }
function c10(): void { say("map-of-entries", new Map(Object.entries(make10())).get("m10") === new Map(Object.entries(make10())).get("m10")); }

interface R11 { a11: number; m11: () => number }
function make11(): R11 { return { a11: 1, m11: () => 1 }; }
function c11(): void { const seen: unknown[] = []; JSON.stringify(make11(), (_k, v) => { if (typeof v === "function") seen.push(v); return v; }); JSON.stringify(make11(), (_k, v) => { if (typeof v === "function") seen.push(v); return v; }); say("replacer", seen[0] === seen[1]); }

interface R12 { a12: number; m12: () => number }
function make12(): R12 { return { a12: 1, m12: () => 1 }; }
function c12(): void { const { a12: _x, ...r1 } = make12(); const { a12: _y, ...r2 } = make12(); say("rest-pattern", r1.m12 === r2.m12); }

interface R13 { a13: number; m13: () => number }
function make13(): R13 { return { a13: 1, m13: () => 1 }; }
function c13(): void { say("create", Object.create(make13()).m13 === Object.create(make13()).m13); }

interface R14 { a14: number; m14: () => number }
function make14(): R14 { return { a14: 1, m14: () => 1 }; }
function c14(): void { say("set-prototype-of", (Object.setPrototypeOf({}, make14()) as any).m14 === (Object.setPrototypeOf({}, make14()) as any).m14); }

interface R15 { a15: number; m15: () => number }
function make15(): R15 { return { a15: 1, m15: () => 1 }; }
function c15(): void { const fs: unknown[] = []; for (const r of [make15(), make15()]) for (const k in r) fs.push((r as any)[k]); say("for-in", fs[1] === fs[3]); }

interface R16 { a16: number; m16: () => number }
function make16(): R16 { return { a16: 1, m16: () => 1 }; }
function c16(): void { const fs: unknown[] = []; Object.entries(make16()).forEach(([_k, v]) => fs.push(v)); Object.entries(make16()).forEach(([_k, v]) => fs.push(v)); say("entries-for-each", fs[1] === fs[3]); }

interface R17 { a17: number; m17: () => number }
function make17(): R17 { return { a17: 1, m17: () => 1 }; }
function c17(): void { const fs = [make17(), make17()].map(r => r.m17); say("map-by-name", fs[0] === fs[1]); }

interface R18 { a18: number; m18: () => number }
function make18(): R18 { return { a18: 1, m18: () => 1 }; }
function c18(): void { say("freeze-then-values", Object.values(Object.freeze(make18()))[1] === Object.values(Object.freeze(make18()))[1]); }

interface R19 { a19: number; m19: () => number }
function make19(): R19 { return { a19: 1, m19: () => 1 }; }
function c19(): void { say("array-from-values", Array.from(Object.values(make19()))[1] === Array.from(Object.values(make19()))[1]); }

interface R20 { a20: number; m20: () => number }
function make20(): R20 { return { a20: 1, m20: () => 1 }; }
function vals20(r: R20): unknown[] { return Object.values(r); }
function c20(): void { say("values-in-a-callee", vals20(make20())[1] === vals20(make20())[1]); }

interface R21 { a21: number; m21: () => number }
function make21(): R21 { return { a21: 1, m21: () => 1 }; }
function vals21<T extends object>(r: T): unknown[] { return Object.values(r); }
function c21(): void { say("values-of-a-generic", vals21(make21())[1] === vals21(make21())[1]); }

interface R22 { a22: number; m22: () => number }
function make22(): R22 { return { a22: 1, m22: () => 1 }; }
function c22(): void { say("values-set", new Set([...Object.values(make22()), ...Object.values(make22())]).size); }

interface R23 { a23: number; m23: () => number }
function make23(): R23 { return { a23: 1, m23: () => 1 }; }
function c23(): void { (Object.values(make23())[1] as any).tag = 1; say("values-written", (Object.values(make23())[1] as any).tag); }

interface R24 { a24: number; m24: () => number }
function make24(): R24 { return { a24: 1, m24: () => 1 }; }
function c24(): void { const g = Object.groupBy([make24(), make24()], r => "k"); say("group-by", g.k![0].m24 === g.k![1].m24); }

interface R25 { a25: number; m25: () => number }
function make25(): R25 { return { a25: 1, m25: () => 1 }; }
function c25(): void { let threw = false; try { structuredClone(make25()); } catch { threw = true; } say("structured", threw); }

interface R26 { a26: number; m26: () => number }
function make26(): R26 { return { a26: 1, m26: () => 1 }; }
function c26(): void { const xs = [make26(), make26()].toSorted((p, q) => p.a26 - q.a26); say("to-sorted", xs[0].m26 === xs[1].m26); }

interface R27 { a27: number; m27: () => number }
function make27(): R27 { return { a27: 1, m27: () => 1 }; }
function c27(): void { say("has-own", Object.hasOwn(make27(), "m27")); }

interface R28 { a28: number; m28: () => number }
function make28(): R28 { return { a28: 1, m28: () => 1 }; }
function c28(): void { const r = make28(), s = make28(); const k = Object.keys(r)[1] as keyof R28; say("keys-then-key", r[k] === s[k]); }

interface R29 { a29: number; m29: () => number }
function make29(): R29 { return { a29: 1, m29: () => 1 }; }
function c29(): void { const xs = [make29(), make29()].map(Object.values); say("map-values", xs[0][1] === xs[1][1]); }

interface R30 { a30: number; m30: () => number }
function make30(): R30 { return { a30: 1, m30: () => 1 }; }
function c30(): void { const xs = [make30(), make30()].flatMap(Object.values); say("flat-map-values", xs[1] === xs[3]); }

interface R31 { a31: number; m31: () => number }
function make31(): R31 { return { a31: 1, m31: () => 1 }; }
function c31(): void { const xs = Array.from([make31(), make31()], Object.values); say("array-from-mapper", xs[0][1] === xs[1][1]); }

interface R32 { a32: number; m32: () => number }
function make32(): R32 { return { a32: 1, m32: () => 1 }; }
function vals32(r: unknown): unknown[] { return Object.values(r as object); }
function c32(): void { say("values-of-unknown", vals32(make32())[1] === vals32(make32())[1]); }

interface R33 { a33: number; m33: () => number }
function make33(): R33 { return { a33: 1, m33: () => 1 }; }
interface O33 { inner: R33 }
function outer33(): O33 { return { inner: make33() }; }
function c33(): void { say("values-of-a-field", (Object.values(outer33())[0] as any).m33 === (Object.values(outer33())[0] as any).m33); }

interface R34 { a34: number; m34: () => number }
function make34(): R34 { return { a34: 1, m34: () => 1 }; }
function c34(): void { say("values-of-an-array", (Object.values([make34()])[0] as any).m34 === (Object.values([make34()])[0] as any).m34); }

interface R35 { a35: number; m35: () => number }
function make35(): R35 { return { a35: 1, m35: () => 1 }; }
function run35(k: (r: R35) => unknown[]): unknown[] { return k(make35()); }
function c35(): void { say("callback-value", run35(Object.values)[1] === run35(Object.values)[1]); }

interface R36 { a36: number; m36: () => number }
function make36(): R36 { return { a36: 1, m36: () => 1 }; }
interface T36 { f: (o: {}) => unknown[] }
function tool36(): T36 { return { f: Object.values }; }
function c36(): void { say("field-holds-a-built-in", tool36().f(make36())[1] === tool36().f(make36())[1]); }

interface R37 { a37: number; m37: () => number }
function make37(): R37 { return { a37: 1, m37: () => 1 }; }
function c37(): void { const fs: unknown[] = []; for (let i = 0; i < 2; i++) { try { throw make37(); } catch (e) { fs.push((e as any).m37); } } say("thrown", fs[0] === fs[1]); }

interface R38 { a38: number; m38: () => number }
function make38(): R38 { return { a38: 1, m38: () => 1 }; }
function c38(): void { const v = Object.values.bind(Object); say("bound", v(make38())[1] === v(make38())[1]); }

c1(); c2(); c3(); c4(); c5(); c6(); c7(); c8(); c9(); c10(); c11(); c12(); c13(); c14(); c15(); c16(); c17(); c18(); c19(); c20(); c21(); c22(); c23(); c24(); c25(); c26(); c27(); c28(); c29(); c30(); c31(); c32(); c33(); c34(); c35(); c36(); c37(); c38();
console.log(out.join("\n"));
