// Generated program: object and closure identity stays observable when allocations are removed (part 0).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R1 { a1: number; m1: () => number }
function make1(): R1 { return { a1: 1, m1: () => 1 }; }
function c1(): void { say("record/inline/strict-eq", (make1().m1) === (make1().m1)); }

interface R2 { a2: number; m2: () => number }
function make2(): R2 { return { a2: 1, m2: () => 1 }; }
function c2(): void { say("record/inline/strict-ne", (make2().m2) !== (make2().m2)); }

interface R3 { a3: number; m3: () => number }
function make3(): R3 { return { a3: 1, m3: () => 1 }; }
function c3(): void { say("record/inline/loose-eq", (make3().m3) == (make3().m3)); }

interface R4 { a4: number; m4: () => number }
function make4(): R4 { return { a4: 1, m4: () => 1 }; }
function c4(): void { say("record/inline/object-is", Object.is((make4().m4), (make4().m4))); }

interface R5 { a5: number; m5: () => number }
function make5(): R5 { return { a5: 1, m5: () => 1 }; }
function c5(): void { say("record/inline/set", new Set([(make5().m5), (make5().m5)]).size); }

interface R6 { a6: number; m6: () => number }
function make6(): R6 { return { a6: 1, m6: () => 1 }; }
function c6(): void { say("record/inline/map-key", new Map([[(make6().m6), 1], [(make6().m6), 2]]).size); }

interface R7 { a7: number; m7: () => number }
function make7(): R7 { return { a7: 1, m7: () => 1 }; }
function c7(): void { say("record/inline/includes", [(make7().m7)].includes((make7().m7))); }

interface R8 { a8: number; m8: () => number }
function make8(): R8 { return { a8: 1, m8: () => 1 }; }
function c8(): void { say("record/inline/index-of", [(make8().m8)].indexOf((make8().m8))); }

interface R9 { a9: number; m9: () => number }
function make9(): R9 { return { a9: 1, m9: () => 1 }; }
const ws9 = new WeakSet<object>();
function c9(): void { say("record/inline/weak-set", (ws9.add((make9().m9) as object), ws9.has((make9().m9) as object))); }

interface R10 { a10: number; m10: () => number }
function make10(): R10 { return { a10: 1, m10: () => 1 }; }
const wm10 = new WeakMap<object, number>();
function c10(): void { say("record/inline/weak-map", (wm10.set((make10().m10) as object, 1), wm10.has((make10().m10) as object))); }

interface R11 { a11: number; m11: () => number }
function make11(): R11 { return { a11: 1, m11: () => 1 }; }
function c11(): void { say("record/inline/written", ((((make11().m11)) as any).tag = 1, (((make11().m11)) as any).tag)); }

interface R12 { a12: number; m12: () => number }
function make12(): R12 { return { a12: 1, m12: () => 1 }; }
function c12(): void { say("record/inline/defined", (Object.defineProperty((make12().m12) as object, "t", { value: 1 }), "t" in ((make12().m12) as object))); }

interface R13 { a13: number; m13: () => number }
function make13(): R13 { return { a13: 1, m13: () => 1 }; }
function c13(): void { say("record/inline/frozen", (Object.freeze((make13().m13)), Object.isFrozen((make13().m13)))); }

interface R14 { a14: number; m14: () => number }
function make14(): R14 { return { a14: 1, m14: () => 1 }; }
function c14(): void { say("record/inline/prototype-set", (Object.setPrototypeOf((make14().m14) as object, null), Object.getPrototypeOf((make14().m14)) === null)); }

interface R15 { a15: number; m15: () => number }
function make15(): R15 { return { a15: 1, m15: () => 1 }; }
function c15(): void { say("record/inline/deleted", (delete (((make15().m15)) as any).length, Object.hasOwn((make15().m15) as object, "length"))); }

interface R16 { a16: number; m16: () => number }
function make16(): R16 { return { a16: 1, m16: () => 1 }; }
function same16(a: unknown, b: unknown): boolean { return a === b; }
function c16(): void { say("record/inline/in-a-callee", same16((make16().m16), (make16().m16))); }

interface R17 { a17: number; m17: () => number }
function make17(): R17 { return { a17: 1, m17: () => 1 }; }
function hit17(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c17(): void { say("record/inline/switch", hit17((make17().m17), (make17().m17))); }

interface R18 { a18: number; m18: () => number }
function make18(): R18 { return { a18: 1, m18: () => 1 }; }
let last18: unknown;
function seen18(f: unknown): boolean { const same = f === last18; last18 = f; return same; }
function c18(): void { say("record/inline/kept-then-compared", (seen18((make18().m18)), seen18((make18().m18)))); }

interface R19 { a19: number; m19: () => number }
function make19(): R19 { return { a19: 1, m19: () => 1 }; }
function get19(): unknown { return make19().m19; }
function c19(): void { say("record/getter/strict-eq", (get19()) === (get19())); }

interface R20 { a20: number; m20: () => number }
function make20(): R20 { return { a20: 1, m20: () => 1 }; }
function get20(): unknown { return make20().m20; }
function c20(): void { say("record/getter/strict-ne", (get20()) !== (get20())); }

interface R21 { a21: number; m21: () => number }
function make21(): R21 { return { a21: 1, m21: () => 1 }; }
function get21(): unknown { return make21().m21; }
function c21(): void { say("record/getter/loose-eq", (get21()) == (get21())); }

interface R22 { a22: number; m22: () => number }
function make22(): R22 { return { a22: 1, m22: () => 1 }; }
function get22(): unknown { return make22().m22; }
function c22(): void { say("record/getter/object-is", Object.is((get22()), (get22()))); }

interface R23 { a23: number; m23: () => number }
function make23(): R23 { return { a23: 1, m23: () => 1 }; }
function get23(): unknown { return make23().m23; }
function c23(): void { say("record/getter/set", new Set([(get23()), (get23())]).size); }

interface R24 { a24: number; m24: () => number }
function make24(): R24 { return { a24: 1, m24: () => 1 }; }
function get24(): unknown { return make24().m24; }
function c24(): void { say("record/getter/map-key", new Map([[(get24()), 1], [(get24()), 2]]).size); }

interface R25 { a25: number; m25: () => number }
function make25(): R25 { return { a25: 1, m25: () => 1 }; }
function get25(): unknown { return make25().m25; }
function c25(): void { say("record/getter/includes", [(get25())].includes((get25()))); }

interface R26 { a26: number; m26: () => number }
function make26(): R26 { return { a26: 1, m26: () => 1 }; }
function get26(): unknown { return make26().m26; }
function c26(): void { say("record/getter/index-of", [(get26())].indexOf((get26()))); }

interface R27 { a27: number; m27: () => number }
function make27(): R27 { return { a27: 1, m27: () => 1 }; }
function get27(): unknown { return make27().m27; }
const ws27 = new WeakSet<object>();
function c27(): void { say("record/getter/weak-set", (ws27.add((get27()) as object), ws27.has((get27()) as object))); }

interface R28 { a28: number; m28: () => number }
function make28(): R28 { return { a28: 1, m28: () => 1 }; }
function get28(): unknown { return make28().m28; }
const wm28 = new WeakMap<object, number>();
function c28(): void { say("record/getter/weak-map", (wm28.set((get28()) as object, 1), wm28.has((get28()) as object))); }

interface R29 { a29: number; m29: () => number }
function make29(): R29 { return { a29: 1, m29: () => 1 }; }
function get29(): unknown { return make29().m29; }
function c29(): void { say("record/getter/written", ((((get29())) as any).tag = 1, (((get29())) as any).tag)); }

interface R30 { a30: number; m30: () => number }
function make30(): R30 { return { a30: 1, m30: () => 1 }; }
function get30(): unknown { return make30().m30; }
function c30(): void { say("record/getter/defined", (Object.defineProperty((get30()) as object, "t", { value: 1 }), "t" in ((get30()) as object))); }

interface R31 { a31: number; m31: () => number }
function make31(): R31 { return { a31: 1, m31: () => 1 }; }
function get31(): unknown { return make31().m31; }
function c31(): void { say("record/getter/frozen", (Object.freeze((get31())), Object.isFrozen((get31())))); }

interface R32 { a32: number; m32: () => number }
function make32(): R32 { return { a32: 1, m32: () => 1 }; }
function get32(): unknown { return make32().m32; }
function c32(): void { say("record/getter/prototype-set", (Object.setPrototypeOf((get32()) as object, null), Object.getPrototypeOf((get32())) === null)); }

interface R33 { a33: number; m33: () => number }
function make33(): R33 { return { a33: 1, m33: () => 1 }; }
function get33(): unknown { return make33().m33; }
function c33(): void { say("record/getter/deleted", (delete (((get33())) as any).length, Object.hasOwn((get33()) as object, "length"))); }

interface R34 { a34: number; m34: () => number }
function make34(): R34 { return { a34: 1, m34: () => 1 }; }
function get34(): unknown { return make34().m34; }
function same34(a: unknown, b: unknown): boolean { return a === b; }
function c34(): void { say("record/getter/in-a-callee", same34((get34()), (get34()))); }

interface R35 { a35: number; m35: () => number }
function make35(): R35 { return { a35: 1, m35: () => 1 }; }
function get35(): unknown { return make35().m35; }
function hit35(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c35(): void { say("record/getter/switch", hit35((get35()), (get35()))); }

interface R36 { a36: number; m36: () => number }
function make36(): R36 { return { a36: 1, m36: () => 1 }; }
function get36(): unknown { return make36().m36; }
let last36: unknown;
function seen36(f: unknown): boolean { const same = f === last36; last36 = f; return same; }
function c36(): void { say("record/getter/kept-then-compared", (seen36((get36())), seen36((get36())))); }

interface R37 { a37: number; m37: () => number }
function make37(): R37 { return { a37: 1, m37: () => 1 }; }
function get37a(): unknown { return make37().m37; }
function get37b(): unknown { return get37a(); }
function get37(): unknown { return get37b(); }
function c37(): void { say("record/forwarded/strict-eq", (get37()) === (get37())); }

interface R38 { a38: number; m38: () => number }
function make38(): R38 { return { a38: 1, m38: () => 1 }; }
function get38a(): unknown { return make38().m38; }
function get38b(): unknown { return get38a(); }
function get38(): unknown { return get38b(); }
function c38(): void { say("record/forwarded/strict-ne", (get38()) !== (get38())); }

interface R39 { a39: number; m39: () => number }
function make39(): R39 { return { a39: 1, m39: () => 1 }; }
function get39a(): unknown { return make39().m39; }
function get39b(): unknown { return get39a(); }
function get39(): unknown { return get39b(); }
function c39(): void { say("record/forwarded/loose-eq", (get39()) == (get39())); }

interface R40 { a40: number; m40: () => number }
function make40(): R40 { return { a40: 1, m40: () => 1 }; }
function get40a(): unknown { return make40().m40; }
function get40b(): unknown { return get40a(); }
function get40(): unknown { return get40b(); }
function c40(): void { say("record/forwarded/object-is", Object.is((get40()), (get40()))); }

interface R41 { a41: number; m41: () => number }
function make41(): R41 { return { a41: 1, m41: () => 1 }; }
function get41a(): unknown { return make41().m41; }
function get41b(): unknown { return get41a(); }
function get41(): unknown { return get41b(); }
function c41(): void { say("record/forwarded/set", new Set([(get41()), (get41())]).size); }

interface R42 { a42: number; m42: () => number }
function make42(): R42 { return { a42: 1, m42: () => 1 }; }
function get42a(): unknown { return make42().m42; }
function get42b(): unknown { return get42a(); }
function get42(): unknown { return get42b(); }
function c42(): void { say("record/forwarded/map-key", new Map([[(get42()), 1], [(get42()), 2]]).size); }

interface R43 { a43: number; m43: () => number }
function make43(): R43 { return { a43: 1, m43: () => 1 }; }
function get43a(): unknown { return make43().m43; }
function get43b(): unknown { return get43a(); }
function get43(): unknown { return get43b(); }
function c43(): void { say("record/forwarded/includes", [(get43())].includes((get43()))); }

interface R44 { a44: number; m44: () => number }
function make44(): R44 { return { a44: 1, m44: () => 1 }; }
function get44a(): unknown { return make44().m44; }
function get44b(): unknown { return get44a(); }
function get44(): unknown { return get44b(); }
function c44(): void { say("record/forwarded/index-of", [(get44())].indexOf((get44()))); }

interface R45 { a45: number; m45: () => number }
function make45(): R45 { return { a45: 1, m45: () => 1 }; }
function get45a(): unknown { return make45().m45; }
function get45b(): unknown { return get45a(); }
function get45(): unknown { return get45b(); }
const ws45 = new WeakSet<object>();
function c45(): void { say("record/forwarded/weak-set", (ws45.add((get45()) as object), ws45.has((get45()) as object))); }

interface R46 { a46: number; m46: () => number }
function make46(): R46 { return { a46: 1, m46: () => 1 }; }
function get46a(): unknown { return make46().m46; }
function get46b(): unknown { return get46a(); }
function get46(): unknown { return get46b(); }
const wm46 = new WeakMap<object, number>();
function c46(): void { say("record/forwarded/weak-map", (wm46.set((get46()) as object, 1), wm46.has((get46()) as object))); }

interface R47 { a47: number; m47: () => number }
function make47(): R47 { return { a47: 1, m47: () => 1 }; }
function get47a(): unknown { return make47().m47; }
function get47b(): unknown { return get47a(); }
function get47(): unknown { return get47b(); }
function c47(): void { say("record/forwarded/written", ((((get47())) as any).tag = 1, (((get47())) as any).tag)); }

interface R48 { a48: number; m48: () => number }
function make48(): R48 { return { a48: 1, m48: () => 1 }; }
function get48a(): unknown { return make48().m48; }
function get48b(): unknown { return get48a(); }
function get48(): unknown { return get48b(); }
function c48(): void { say("record/forwarded/defined", (Object.defineProperty((get48()) as object, "t", { value: 1 }), "t" in ((get48()) as object))); }

interface R49 { a49: number; m49: () => number }
function make49(): R49 { return { a49: 1, m49: () => 1 }; }
function get49a(): unknown { return make49().m49; }
function get49b(): unknown { return get49a(); }
function get49(): unknown { return get49b(); }
function c49(): void { say("record/forwarded/frozen", (Object.freeze((get49())), Object.isFrozen((get49())))); }

interface R50 { a50: number; m50: () => number }
function make50(): R50 { return { a50: 1, m50: () => 1 }; }
function get50a(): unknown { return make50().m50; }
function get50b(): unknown { return get50a(); }
function get50(): unknown { return get50b(); }
function c50(): void { say("record/forwarded/prototype-set", (Object.setPrototypeOf((get50()) as object, null), Object.getPrototypeOf((get50())) === null)); }

interface R51 { a51: number; m51: () => number }
function make51(): R51 { return { a51: 1, m51: () => 1 }; }
function get51a(): unknown { return make51().m51; }
function get51b(): unknown { return get51a(); }
function get51(): unknown { return get51b(); }
function c51(): void { say("record/forwarded/deleted", (delete (((get51())) as any).length, Object.hasOwn((get51()) as object, "length"))); }

interface R52 { a52: number; m52: () => number }
function make52(): R52 { return { a52: 1, m52: () => 1 }; }
function get52a(): unknown { return make52().m52; }
function get52b(): unknown { return get52a(); }
function get52(): unknown { return get52b(); }
function same52(a: unknown, b: unknown): boolean { return a === b; }
function c52(): void { say("record/forwarded/in-a-callee", same52((get52()), (get52()))); }

interface R53 { a53: number; m53: () => number }
function make53(): R53 { return { a53: 1, m53: () => 1 }; }
function get53a(): unknown { return make53().m53; }
function get53b(): unknown { return get53a(); }
function get53(): unknown { return get53b(); }
function hit53(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c53(): void { say("record/forwarded/switch", hit53((get53()), (get53()))); }

interface R54 { a54: number; m54: () => number }
function make54(): R54 { return { a54: 1, m54: () => 1 }; }
function get54a(): unknown { return make54().m54; }
function get54b(): unknown { return get54a(); }
function get54(): unknown { return get54b(); }
let last54: unknown;
function seen54(f: unknown): boolean { const same = f === last54; last54 = f; return same; }
function c54(): void { say("record/forwarded/kept-then-compared", (seen54((get54())), seen54((get54())))); }

interface R55 { a55: number; m55: () => number }
function make55(): R55 { return { a55: 1, m55: () => 1 }; }
function pick55(x: R55): unknown { return x.m55; }
function c55(): void { say("record/picked/strict-eq", (pick55(make55())) === (pick55(make55()))); }

interface R56 { a56: number; m56: () => number }
function make56(): R56 { return { a56: 1, m56: () => 1 }; }
function pick56(x: R56): unknown { return x.m56; }
function c56(): void { say("record/picked/strict-ne", (pick56(make56())) !== (pick56(make56()))); }

interface R57 { a57: number; m57: () => number }
function make57(): R57 { return { a57: 1, m57: () => 1 }; }
function pick57(x: R57): unknown { return x.m57; }
function c57(): void { say("record/picked/loose-eq", (pick57(make57())) == (pick57(make57()))); }

interface R58 { a58: number; m58: () => number }
function make58(): R58 { return { a58: 1, m58: () => 1 }; }
function pick58(x: R58): unknown { return x.m58; }
function c58(): void { say("record/picked/object-is", Object.is((pick58(make58())), (pick58(make58())))); }

interface R59 { a59: number; m59: () => number }
function make59(): R59 { return { a59: 1, m59: () => 1 }; }
function pick59(x: R59): unknown { return x.m59; }
function c59(): void { say("record/picked/set", new Set([(pick59(make59())), (pick59(make59()))]).size); }

interface R60 { a60: number; m60: () => number }
function make60(): R60 { return { a60: 1, m60: () => 1 }; }
function pick60(x: R60): unknown { return x.m60; }
function c60(): void { say("record/picked/map-key", new Map([[(pick60(make60())), 1], [(pick60(make60())), 2]]).size); }

c1(); c2(); c3(); c4(); c5(); c6(); c7(); c8(); c9(); c10(); c11(); c12(); c13(); c14(); c15(); c16(); c17(); c18(); c19(); c20(); c21(); c22(); c23(); c24(); c25(); c26(); c27(); c28(); c29(); c30(); c31(); c32(); c33(); c34(); c35(); c36(); c37(); c38(); c39(); c40(); c41(); c42(); c43(); c44(); c45(); c46(); c47(); c48(); c49(); c50(); c51(); c52(); c53(); c54(); c55(); c56(); c57(); c58(); c59(); c60();
console.log(out.join("\n"));
