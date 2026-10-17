// Generated program: object and closure identity stays observable when allocations are removed (second series, part 0).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R1 { a1: number; m1: () => number }
function make1(): R1 { return { a1: 1, m1: () => 1 }; }
class K1 { #f: unknown; constructor() { this.#f = make1().m1; } get(): unknown { return this.#f; } }
function c1(): void { say("record/private-field/strict-eq", (new K1().get()) === (new K1().get())); }

interface R2 { a2: number; m2: () => number }
function make2(): R2 { return { a2: 1, m2: () => 1 }; }
class K2 { #f: unknown; constructor() { this.#f = make2().m2; } get(): unknown { return this.#f; } }
function c2(): void { say("record/private-field/strict-ne", (new K2().get()) !== (new K2().get())); }

interface R3 { a3: number; m3: () => number }
function make3(): R3 { return { a3: 1, m3: () => 1 }; }
class K3 { #f: unknown; constructor() { this.#f = make3().m3; } get(): unknown { return this.#f; } }
function c3(): void { say("record/private-field/loose-eq", (new K3().get()) == (new K3().get())); }

interface R4 { a4: number; m4: () => number }
function make4(): R4 { return { a4: 1, m4: () => 1 }; }
class K4 { #f: unknown; constructor() { this.#f = make4().m4; } get(): unknown { return this.#f; } }
function c4(): void { say("record/private-field/object-is", Object.is((new K4().get()), (new K4().get()))); }

interface R5 { a5: number; m5: () => number }
function make5(): R5 { return { a5: 1, m5: () => 1 }; }
class K5 { #f: unknown; constructor() { this.#f = make5().m5; } get(): unknown { return this.#f; } }
function c5(): void { say("record/private-field/set", new Set([(new K5().get()), (new K5().get())]).size); }

interface R6 { a6: number; m6: () => number }
function make6(): R6 { return { a6: 1, m6: () => 1 }; }
class K6 { #f: unknown; constructor() { this.#f = make6().m6; } get(): unknown { return this.#f; } }
function c6(): void { say("record/private-field/map-key", new Map([[(new K6().get()), 1], [(new K6().get()), 2]]).size); }

interface R7 { a7: number; m7: () => number }
function make7(): R7 { return { a7: 1, m7: () => 1 }; }
class K7 { #f: unknown; constructor() { this.#f = make7().m7; } get(): unknown { return this.#f; } }
function c7(): void { say("record/private-field/includes", [(new K7().get())].includes((new K7().get()))); }

interface R8 { a8: number; m8: () => number }
function make8(): R8 { return { a8: 1, m8: () => 1 }; }
class K8 { #f: unknown; constructor() { this.#f = make8().m8; } get(): unknown { return this.#f; } }
function c8(): void { say("record/private-field/index-of", [(new K8().get())].indexOf((new K8().get()))); }

interface R9 { a9: number; m9: () => number }
function make9(): R9 { return { a9: 1, m9: () => 1 }; }
class K9 { #f: unknown; constructor() { this.#f = make9().m9; } get(): unknown { return this.#f; } }
const ws9 = new WeakSet<object>();
function c9(): void { say("record/private-field/weak-set", (ws9.add((new K9().get()) as object), ws9.has((new K9().get()) as object))); }

interface R10 { a10: number; m10: () => number }
function make10(): R10 { return { a10: 1, m10: () => 1 }; }
class K10 { #f: unknown; constructor() { this.#f = make10().m10; } get(): unknown { return this.#f; } }
const wm10 = new WeakMap<object, number>();
function c10(): void { say("record/private-field/weak-map", (wm10.set((new K10().get()) as object, 1), wm10.has((new K10().get()) as object))); }

interface R11 { a11: number; m11: () => number }
function make11(): R11 { return { a11: 1, m11: () => 1 }; }
class K11 { #f: unknown; constructor() { this.#f = make11().m11; } get(): unknown { return this.#f; } }
function c11(): void { say("record/private-field/written", ((((new K11().get())) as any).tag = 1, (((new K11().get())) as any).tag)); }

interface R12 { a12: number; m12: () => number }
function make12(): R12 { return { a12: 1, m12: () => 1 }; }
class K12 { #f: unknown; constructor() { this.#f = make12().m12; } get(): unknown { return this.#f; } }
function c12(): void { say("record/private-field/defined", (Object.defineProperty((new K12().get()) as object, "t", { value: 1 }), "t" in ((new K12().get()) as object))); }

interface R13 { a13: number; m13: () => number }
function make13(): R13 { return { a13: 1, m13: () => 1 }; }
class K13 { #f: unknown; constructor() { this.#f = make13().m13; } get(): unknown { return this.#f; } }
function c13(): void { say("record/private-field/frozen", (Object.freeze((new K13().get())), Object.isFrozen((new K13().get())))); }

interface R14 { a14: number; m14: () => number }
function make14(): R14 { return { a14: 1, m14: () => 1 }; }
class K14 { #f: unknown; constructor() { this.#f = make14().m14; } get(): unknown { return this.#f; } }
function c14(): void { say("record/private-field/prototype-set", (Object.setPrototypeOf((new K14().get()) as object, null), Object.getPrototypeOf((new K14().get())) === null)); }

interface R15 { a15: number; m15: () => number }
function make15(): R15 { return { a15: 1, m15: () => 1 }; }
class K15 { #f: unknown; constructor() { this.#f = make15().m15; } get(): unknown { return this.#f; } }
function c15(): void { say("record/private-field/deleted", (delete (((new K15().get())) as any).length, Object.hasOwn((new K15().get()) as object, "length"))); }

interface R16 { a16: number; m16: () => number }
function make16(): R16 { return { a16: 1, m16: () => 1 }; }
class K16 { #f: unknown; constructor() { this.#f = make16().m16; } get(): unknown { return this.#f; } }
function same16(a: unknown, b: unknown): boolean { return a === b; }
function c16(): void { say("record/private-field/in-a-callee", same16((new K16().get()), (new K16().get()))); }

interface R17 { a17: number; m17: () => number }
function make17(): R17 { return { a17: 1, m17: () => 1 }; }
class K17 { #f: unknown; constructor() { this.#f = make17().m17; } get(): unknown { return this.#f; } }
function hit17(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c17(): void { say("record/private-field/switch", hit17((new K17().get()), (new K17().get()))); }

interface R18 { a18: number; m18: () => number }
function make18(): R18 { return { a18: 1, m18: () => 1 }; }
class K18 { #f: unknown; constructor() { this.#f = make18().m18; } get(): unknown { return this.#f; } }
let last18: unknown;
function seen18(f: unknown): boolean { const same = f === last18; last18 = f; return same; }
function c18(): void { say("record/private-field/kept-then-compared", (seen18((new K18().get())), seen18((new K18().get())))); }

interface R19 { a19: number; m19: () => number }
function make19(): R19 { return { a19: 1, m19: () => 1 }; }
class K19 { static f: unknown; }
function c19(): void { say("record/static-field/strict-eq", ((K19.f = make19().m19, K19.f)) === ((K19.f = make19().m19, K19.f))); }

interface R20 { a20: number; m20: () => number }
function make20(): R20 { return { a20: 1, m20: () => 1 }; }
class K20 { static f: unknown; }
function c20(): void { say("record/static-field/strict-ne", ((K20.f = make20().m20, K20.f)) !== ((K20.f = make20().m20, K20.f))); }

interface R21 { a21: number; m21: () => number }
function make21(): R21 { return { a21: 1, m21: () => 1 }; }
class K21 { static f: unknown; }
function c21(): void { say("record/static-field/loose-eq", ((K21.f = make21().m21, K21.f)) == ((K21.f = make21().m21, K21.f))); }

interface R22 { a22: number; m22: () => number }
function make22(): R22 { return { a22: 1, m22: () => 1 }; }
class K22 { static f: unknown; }
function c22(): void { say("record/static-field/object-is", Object.is(((K22.f = make22().m22, K22.f)), ((K22.f = make22().m22, K22.f)))); }

interface R23 { a23: number; m23: () => number }
function make23(): R23 { return { a23: 1, m23: () => 1 }; }
class K23 { static f: unknown; }
function c23(): void { say("record/static-field/set", new Set([((K23.f = make23().m23, K23.f)), ((K23.f = make23().m23, K23.f))]).size); }

interface R24 { a24: number; m24: () => number }
function make24(): R24 { return { a24: 1, m24: () => 1 }; }
class K24 { static f: unknown; }
function c24(): void { say("record/static-field/map-key", new Map([[((K24.f = make24().m24, K24.f)), 1], [((K24.f = make24().m24, K24.f)), 2]]).size); }

interface R25 { a25: number; m25: () => number }
function make25(): R25 { return { a25: 1, m25: () => 1 }; }
class K25 { static f: unknown; }
function c25(): void { say("record/static-field/includes", [((K25.f = make25().m25, K25.f))].includes(((K25.f = make25().m25, K25.f)))); }

interface R26 { a26: number; m26: () => number }
function make26(): R26 { return { a26: 1, m26: () => 1 }; }
class K26 { static f: unknown; }
function c26(): void { say("record/static-field/index-of", [((K26.f = make26().m26, K26.f))].indexOf(((K26.f = make26().m26, K26.f)))); }

interface R27 { a27: number; m27: () => number }
function make27(): R27 { return { a27: 1, m27: () => 1 }; }
class K27 { static f: unknown; }
const ws27 = new WeakSet<object>();
function c27(): void { say("record/static-field/weak-set", (ws27.add(((K27.f = make27().m27, K27.f)) as object), ws27.has(((K27.f = make27().m27, K27.f)) as object))); }

interface R28 { a28: number; m28: () => number }
function make28(): R28 { return { a28: 1, m28: () => 1 }; }
class K28 { static f: unknown; }
const wm28 = new WeakMap<object, number>();
function c28(): void { say("record/static-field/weak-map", (wm28.set(((K28.f = make28().m28, K28.f)) as object, 1), wm28.has(((K28.f = make28().m28, K28.f)) as object))); }

interface R29 { a29: number; m29: () => number }
function make29(): R29 { return { a29: 1, m29: () => 1 }; }
class K29 { static f: unknown; }
function c29(): void { say("record/static-field/written", (((((K29.f = make29().m29, K29.f))) as any).tag = 1, ((((K29.f = make29().m29, K29.f))) as any).tag)); }

interface R30 { a30: number; m30: () => number }
function make30(): R30 { return { a30: 1, m30: () => 1 }; }
class K30 { static f: unknown; }
function c30(): void { say("record/static-field/defined", (Object.defineProperty(((K30.f = make30().m30, K30.f)) as object, "t", { value: 1 }), "t" in (((K30.f = make30().m30, K30.f)) as object))); }

interface R31 { a31: number; m31: () => number }
function make31(): R31 { return { a31: 1, m31: () => 1 }; }
class K31 { static f: unknown; }
function c31(): void { say("record/static-field/frozen", (Object.freeze(((K31.f = make31().m31, K31.f))), Object.isFrozen(((K31.f = make31().m31, K31.f))))); }

interface R32 { a32: number; m32: () => number }
function make32(): R32 { return { a32: 1, m32: () => 1 }; }
class K32 { static f: unknown; }
function c32(): void { say("record/static-field/prototype-set", (Object.setPrototypeOf(((K32.f = make32().m32, K32.f)) as object, null), Object.getPrototypeOf(((K32.f = make32().m32, K32.f))) === null)); }

interface R33 { a33: number; m33: () => number }
function make33(): R33 { return { a33: 1, m33: () => 1 }; }
class K33 { static f: unknown; }
function c33(): void { say("record/static-field/deleted", (delete ((((K33.f = make33().m33, K33.f))) as any).length, Object.hasOwn(((K33.f = make33().m33, K33.f)) as object, "length"))); }

interface R34 { a34: number; m34: () => number }
function make34(): R34 { return { a34: 1, m34: () => 1 }; }
class K34 { static f: unknown; }
function same34(a: unknown, b: unknown): boolean { return a === b; }
function c34(): void { say("record/static-field/in-a-callee", same34(((K34.f = make34().m34, K34.f)), ((K34.f = make34().m34, K34.f)))); }

interface R35 { a35: number; m35: () => number }
function make35(): R35 { return { a35: 1, m35: () => 1 }; }
class K35 { static f: unknown; }
function hit35(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c35(): void { say("record/static-field/switch", hit35(((K35.f = make35().m35, K35.f)), ((K35.f = make35().m35, K35.f)))); }

interface R36 { a36: number; m36: () => number }
function make36(): R36 { return { a36: 1, m36: () => 1 }; }
class K36 { static f: unknown; }
let last36: unknown;
function seen36(f: unknown): boolean { const same = f === last36; last36 = f; return same; }
function c36(): void { say("record/static-field/kept-then-compared", (seen36(((K36.f = make36().m36, K36.f))), seen36(((K36.f = make36().m36, K36.f))))); }

interface R37 { a37: number; m37: () => number }
function make37(): R37 { return { a37: 1, m37: () => 1 }; }
class K37 { f: unknown = make37().m37; }
function c37(): void { say("record/instance-field/strict-eq", (new K37().f) === (new K37().f)); }

interface R38 { a38: number; m38: () => number }
function make38(): R38 { return { a38: 1, m38: () => 1 }; }
class K38 { f: unknown = make38().m38; }
function c38(): void { say("record/instance-field/strict-ne", (new K38().f) !== (new K38().f)); }

interface R39 { a39: number; m39: () => number }
function make39(): R39 { return { a39: 1, m39: () => 1 }; }
class K39 { f: unknown = make39().m39; }
function c39(): void { say("record/instance-field/loose-eq", (new K39().f) == (new K39().f)); }

interface R40 { a40: number; m40: () => number }
function make40(): R40 { return { a40: 1, m40: () => 1 }; }
class K40 { f: unknown = make40().m40; }
function c40(): void { say("record/instance-field/object-is", Object.is((new K40().f), (new K40().f))); }

interface R41 { a41: number; m41: () => number }
function make41(): R41 { return { a41: 1, m41: () => 1 }; }
class K41 { f: unknown = make41().m41; }
function c41(): void { say("record/instance-field/set", new Set([(new K41().f), (new K41().f)]).size); }

interface R42 { a42: number; m42: () => number }
function make42(): R42 { return { a42: 1, m42: () => 1 }; }
class K42 { f: unknown = make42().m42; }
function c42(): void { say("record/instance-field/map-key", new Map([[(new K42().f), 1], [(new K42().f), 2]]).size); }

interface R43 { a43: number; m43: () => number }
function make43(): R43 { return { a43: 1, m43: () => 1 }; }
class K43 { f: unknown = make43().m43; }
function c43(): void { say("record/instance-field/includes", [(new K43().f)].includes((new K43().f))); }

interface R44 { a44: number; m44: () => number }
function make44(): R44 { return { a44: 1, m44: () => 1 }; }
class K44 { f: unknown = make44().m44; }
function c44(): void { say("record/instance-field/index-of", [(new K44().f)].indexOf((new K44().f))); }

interface R45 { a45: number; m45: () => number }
function make45(): R45 { return { a45: 1, m45: () => 1 }; }
class K45 { f: unknown = make45().m45; }
const ws45 = new WeakSet<object>();
function c45(): void { say("record/instance-field/weak-set", (ws45.add((new K45().f) as object), ws45.has((new K45().f) as object))); }

interface R46 { a46: number; m46: () => number }
function make46(): R46 { return { a46: 1, m46: () => 1 }; }
class K46 { f: unknown = make46().m46; }
const wm46 = new WeakMap<object, number>();
function c46(): void { say("record/instance-field/weak-map", (wm46.set((new K46().f) as object, 1), wm46.has((new K46().f) as object))); }

interface R47 { a47: number; m47: () => number }
function make47(): R47 { return { a47: 1, m47: () => 1 }; }
class K47 { f: unknown = make47().m47; }
function c47(): void { say("record/instance-field/written", ((((new K47().f)) as any).tag = 1, (((new K47().f)) as any).tag)); }

interface R48 { a48: number; m48: () => number }
function make48(): R48 { return { a48: 1, m48: () => 1 }; }
class K48 { f: unknown = make48().m48; }
function c48(): void { say("record/instance-field/defined", (Object.defineProperty((new K48().f) as object, "t", { value: 1 }), "t" in ((new K48().f) as object))); }

interface R49 { a49: number; m49: () => number }
function make49(): R49 { return { a49: 1, m49: () => 1 }; }
class K49 { f: unknown = make49().m49; }
function c49(): void { say("record/instance-field/frozen", (Object.freeze((new K49().f)), Object.isFrozen((new K49().f)))); }

interface R50 { a50: number; m50: () => number }
function make50(): R50 { return { a50: 1, m50: () => 1 }; }
class K50 { f: unknown = make50().m50; }
function c50(): void { say("record/instance-field/prototype-set", (Object.setPrototypeOf((new K50().f) as object, null), Object.getPrototypeOf((new K50().f)) === null)); }

interface R51 { a51: number; m51: () => number }
function make51(): R51 { return { a51: 1, m51: () => 1 }; }
class K51 { f: unknown = make51().m51; }
function c51(): void { say("record/instance-field/deleted", (delete (((new K51().f)) as any).length, Object.hasOwn((new K51().f) as object, "length"))); }

interface R52 { a52: number; m52: () => number }
function make52(): R52 { return { a52: 1, m52: () => 1 }; }
class K52 { f: unknown = make52().m52; }
function same52(a: unknown, b: unknown): boolean { return a === b; }
function c52(): void { say("record/instance-field/in-a-callee", same52((new K52().f), (new K52().f))); }

interface R53 { a53: number; m53: () => number }
function make53(): R53 { return { a53: 1, m53: () => 1 }; }
class K53 { f: unknown = make53().m53; }
function hit53(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c53(): void { say("record/instance-field/switch", hit53((new K53().f), (new K53().f))); }

interface R54 { a54: number; m54: () => number }
function make54(): R54 { return { a54: 1, m54: () => 1 }; }
class K54 { f: unknown = make54().m54; }
let last54: unknown;
function seen54(f: unknown): boolean { const same = f === last54; last54 = f; return same; }
function c54(): void { say("record/instance-field/kept-then-compared", (seen54((new K54().f)), seen54((new K54().f)))); }

interface R55 { a55: number; m55: () => number }
function make55(): R55 { return { a55: 1, m55: () => 1 }; }
class K55 { s: unknown; set v(x: unknown) { this.s = x; } }
function get55(): unknown { const k = new K55(); k.v = make55().m55; return k.s; }
function c55(): void { say("record/setter/strict-eq", (get55()) === (get55())); }

interface R56 { a56: number; m56: () => number }
function make56(): R56 { return { a56: 1, m56: () => 1 }; }
class K56 { s: unknown; set v(x: unknown) { this.s = x; } }
function get56(): unknown { const k = new K56(); k.v = make56().m56; return k.s; }
function c56(): void { say("record/setter/strict-ne", (get56()) !== (get56())); }

interface R57 { a57: number; m57: () => number }
function make57(): R57 { return { a57: 1, m57: () => 1 }; }
class K57 { s: unknown; set v(x: unknown) { this.s = x; } }
function get57(): unknown { const k = new K57(); k.v = make57().m57; return k.s; }
function c57(): void { say("record/setter/loose-eq", (get57()) == (get57())); }

interface R58 { a58: number; m58: () => number }
function make58(): R58 { return { a58: 1, m58: () => 1 }; }
class K58 { s: unknown; set v(x: unknown) { this.s = x; } }
function get58(): unknown { const k = new K58(); k.v = make58().m58; return k.s; }
function c58(): void { say("record/setter/object-is", Object.is((get58()), (get58()))); }

interface R59 { a59: number; m59: () => number }
function make59(): R59 { return { a59: 1, m59: () => 1 }; }
class K59 { s: unknown; set v(x: unknown) { this.s = x; } }
function get59(): unknown { const k = new K59(); k.v = make59().m59; return k.s; }
function c59(): void { say("record/setter/set", new Set([(get59()), (get59())]).size); }

interface R60 { a60: number; m60: () => number }
function make60(): R60 { return { a60: 1, m60: () => 1 }; }
class K60 { s: unknown; set v(x: unknown) { this.s = x; } }
function get60(): unknown { const k = new K60(); k.v = make60().m60; return k.s; }
function c60(): void { say("record/setter/map-key", new Map([[(get60()), 1], [(get60()), 2]]).size); }

c1(); c2(); c3(); c4(); c5(); c6(); c7(); c8(); c9(); c10(); c11(); c12(); c13(); c14(); c15(); c16(); c17(); c18(); c19(); c20(); c21(); c22(); c23(); c24(); c25(); c26(); c27(); c28(); c29(); c30(); c31(); c32(); c33(); c34(); c35(); c36(); c37(); c38(); c39(); c40(); c41(); c42(); c43(); c44(); c45(); c46(); c47(); c48(); c49(); c50(); c51(); c52(); c53(); c54(); c55(); c56(); c57(); c58(); c59(); c60();
console.log(out.join("\n"));
