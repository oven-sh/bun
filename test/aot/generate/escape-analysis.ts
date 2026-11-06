// The programs of escape-analysis that are mostly a table written out: blocks of lines that differ in a few places.
import { programsOf, text } from "../generate";

export const programs = () =>
  programsOf({
    "identity-00.ts": text(
      `// Generated program: object and closure identity stays observable when allocations are removed (part 0).
declare const console: any;
const out: string[] = [];`,
      [
        `say(name: string, value: unknown): void { out.push(name + "=" + String(value)
c1(): void { say("record/inline/strict-eq", (make1().m1) === (make1().m1)
c2(): void { say("record/inline/strict-ne", (make2().m2) !== (make2().m2)
c3(): void { say("record/inline/loose-eq", (make3().m3) == (make3().m3)
c4(): void { say("record/inline/object-is", Object.is((make4().m4), (make4().m4))
c5(): void { say("record/inline/set", new Set([(make5().m5), (make5().m5)]).size
c6(): void { say("record/inline/map-key", new Map([[(make6().m6), 1], [(make6().m6), 2]]).size
c7(): void { say("record/inline/includes", [(make7().m7)].includes((make7().m7))
c8(): void { say("record/inline/index-of", [(make8().m8)].indexOf((make8().m8))`,
        (n, a) => `function ${a}); }

interface R${n + 1} { a${n + 1}: number; m${n + 1}: () => number }
function make${n + 1}(): R${n + 1} { return { a${n + 1}: 1, m${n + 1}: () => 1 }; }`,
      ],
      `const ws9 = new WeakSet<object>();
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
let last18: unknown;`,
      [
        `seen18(f: unknown): boolean { const same = f === last18; last18 = f; return same	18(): void { say("record/inline/kept-then-compared", (seen18((make18().m18)), seen18((make18().m18)))
get19(): unknown { return make19().m19	19(): void { say("record/getter/strict-eq", (get19()) === (get19())
get20(): unknown { return make20().m20	20(): void { say("record/getter/strict-ne", (get20()) !== (get20())
get21(): unknown { return make21().m21	21(): void { say("record/getter/loose-eq", (get21()) == (get21())
get22(): unknown { return make22().m22	22(): void { say("record/getter/object-is", Object.is((get22()), (get22()))
get23(): unknown { return make23().m23	23(): void { say("record/getter/set", new Set([(get23()), (get23())]).size
get24(): unknown { return make24().m24	24(): void { say("record/getter/map-key", new Map([[(get24()), 1], [(get24()), 2]]).size
get25(): unknown { return make25().m25	25(): void { say("record/getter/includes", [(get25())].includes((get25()))
get26(): unknown { return make26().m26	26(): void { say("record/getter/index-of", [(get26())].indexOf((get26()))`,
        (n, a, b) => `function ${a}; }
function c${b}); }

interface R${n + 19} { a${n + 19}: number; m${n + 19}: () => number }
function make${n + 19}(): R${n + 19} { return { a${n + 19}: 1, m${n + 19}: () => 1 }; }`,
      ],
      `function get27(): unknown { return make27().m27; }
const ws27 = new WeakSet<object>();
function c27(): void { say("record/getter/weak-set", (ws27.add((get27()) as object), ws27.has((get27()) as object))); }

interface R28 { a28: number; m28: () => number }
function make28(): R28 { return { a28: 1, m28: () => 1 }; }
function get28(): unknown { return make28().m28; }
const wm28 = new WeakMap<object, number>();`,
      [
        `28(): void { say("record/getter/weak-map", (wm28.set((get28()) as object, 1), wm28.has((get28()) as object)
29(): void { say("record/getter/written", ((((get29())) as any).tag = 1, (((get29())) as any).tag
30(): void { say("record/getter/defined", (Object.defineProperty((get30()) as object, "t", { value: 1 }), "t" in ((get30()) as object)
31(): void { say("record/getter/frozen", (Object.freeze((get31())), Object.isFrozen((get31()))
32(): void { say("record/getter/prototype-set", (Object.setPrototypeOf((get32()) as object, null), Object.getPrototypeOf((get32())) === null
33(): void { say("record/getter/deleted", (delete (((get33())) as any).length, Object.hasOwn((get33()) as object, "length")`,
        (n, a) => `function c${a})); }

interface R${n + 29} { a${n + 29}: number; m${n + 29}: () => number }
function make${n + 29}(): R${n + 29} { return { a${n + 29}: 1, m${n + 29}: () => 1 }; }
function get${n + 29}(): unknown { return make${n + 29}().m${n + 29}; }`,
      ],
      `function same34(a: unknown, b: unknown): boolean { return a === b; }
function c34(): void { say("record/getter/in-a-callee", same34((get34()), (get34()))); }

interface R35 { a35: number; m35: () => number }
function make35(): R35 { return { a35: 1, m35: () => 1 }; }
function get35(): unknown { return make35().m35; }
function hit35(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c35(): void { say("record/getter/switch", hit35((get35()), (get35()))); }

interface R36 { a36: number; m36: () => number }
function make36(): R36 { return { a36: 1, m36: () => 1 }; }
function get36(): unknown { return make36().m36; }
let last36: unknown;`,
      [
        `seen36(f: unknown): boolean { const same = f === last36; last36 = f; return same	36(): void { say("record/getter/kept-then-compared", (seen36((get36())), seen36((get36())))
get37(): unknown { return get37b()	37(): void { say("record/forwarded/strict-eq", (get37()) === (get37())
get38(): unknown { return get38b()	38(): void { say("record/forwarded/strict-ne", (get38()) !== (get38())
get39(): unknown { return get39b()	39(): void { say("record/forwarded/loose-eq", (get39()) == (get39())
get40(): unknown { return get40b()	40(): void { say("record/forwarded/object-is", Object.is((get40()), (get40()))
get41(): unknown { return get41b()	41(): void { say("record/forwarded/set", new Set([(get41()), (get41())]).size
get42(): unknown { return get42b()	42(): void { say("record/forwarded/map-key", new Map([[(get42()), 1], [(get42()), 2]]).size
get43(): unknown { return get43b()	43(): void { say("record/forwarded/includes", [(get43())].includes((get43()))
get44(): unknown { return get44b()	44(): void { say("record/forwarded/index-of", [(get44())].indexOf((get44()))`,
        (n, a, b) => `function ${a}; }
function c${b}); }

interface R${n + 37} { a${n + 37}: number; m${n + 37}: () => number }
function make${n + 37}(): R${n + 37} { return { a${n + 37}: 1, m${n + 37}: () => 1 }; }
function get${n + 37}a(): unknown { return make${n + 37}().m${n + 37}; }
function get${n + 37}b(): unknown { return get${n + 37}a(); }`,
      ],
      `function get45(): unknown { return get45b(); }
const ws45 = new WeakSet<object>();
function c45(): void { say("record/forwarded/weak-set", (ws45.add((get45()) as object), ws45.has((get45()) as object))); }

interface R46 { a46: number; m46: () => number }
function make46(): R46 { return { a46: 1, m46: () => 1 }; }
function get46a(): unknown { return make46().m46; }
function get46b(): unknown { return get46a(); }
function get46(): unknown { return get46b(); }
const wm46 = new WeakMap<object, number>();`,
      [
        `46(): void { say("record/forwarded/weak-map", (wm46.set((get46()) as object, 1), wm46.has((get46()) as object)
47(): void { say("record/forwarded/written", ((((get47())) as any).tag = 1, (((get47())) as any).tag
48(): void { say("record/forwarded/defined", (Object.defineProperty((get48()) as object, "t", { value: 1 }), "t" in ((get48()) as object)
49(): void { say("record/forwarded/frozen", (Object.freeze((get49())), Object.isFrozen((get49()))
50(): void { say("record/forwarded/prototype-set", (Object.setPrototypeOf((get50()) as object, null), Object.getPrototypeOf((get50())) === null
51(): void { say("record/forwarded/deleted", (delete (((get51())) as any).length, Object.hasOwn((get51()) as object, "length")`,
        (n, a) => `function c${a})); }

interface R${n + 47} { a${n + 47}: number; m${n + 47}: () => number }
function make${n + 47}(): R${n + 47} { return { a${n + 47}: 1, m${n + 47}: () => 1 }; }
function get${n + 47}a(): unknown { return make${n + 47}().m${n + 47}; }
function get${n + 47}b(): unknown { return get${n + 47}a(); }
function get${n + 47}(): unknown { return get${n + 47}b(); }`,
      ],
      `function same52(a: unknown, b: unknown): boolean { return a === b; }
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
let last54: unknown;`,
      [
        `seen54(f: unknown): boolean { const same = f === last54; last54 = f; return same	4(): void { say("record/forwarded/kept-then-compared", (seen54((get54())), seen54((get54())))
pick55(x: R55): unknown { return x.m55	5(): void { say("record/picked/strict-eq", (pick55(make55())) === (pick55(make55()))
pick56(x: R56): unknown { return x.m56	6(): void { say("record/picked/strict-ne", (pick56(make56())) !== (pick56(make56()))
pick57(x: R57): unknown { return x.m57	7(): void { say("record/picked/loose-eq", (pick57(make57())) == (pick57(make57()))
pick58(x: R58): unknown { return x.m58	8(): void { say("record/picked/object-is", Object.is((pick58(make58())), (pick58(make58())))
pick59(x: R59): unknown { return x.m59	9(): void { say("record/picked/set", new Set([(pick59(make59())), (pick59(make59()))]).size`,
        (n, a, b) => `function ${a}; }
function c5${b}); }

interface R${n + 55} { a${n + 55}: number; m${n + 55}: () => number }
function make${n + 55}(): R${n + 55} { return { a${n + 55}: 1, m${n + 55}: () => 1 }; }`,
      ],
      `function pick60(x: R60): unknown { return x.m60; }
function c60(): void { say("record/picked/map-key", new Map([[(pick60(make60())), 1], [(pick60(make60())), 2]]).size); }

c1(); c2(); c3(); c4(); c5(); c6(); c7(); c8(); c9(); c10(); c11(); c12(); c13(); c14(); c15(); c16(); c17(); c18(); c19(); c20(); c21(); c22(); c23(); c24(); c25(); c26(); c27(); c28(); c29(); c30(); c31(); c32(); c33(); c34(); c35(); c36(); c37(); c38(); c39(); c40(); c41(); c42(); c43(); c44(); c45(); c46(); c47(); c48(); c49(); c50(); c51(); c52(); c53(); c54(); c55(); c56(); c57(); c58(); c59(); c60();
console.log(out.join("\\n"));
`,
    ),
    "identity-01.ts": text(
      `// Generated program: object and closure identity stays observable when allocations are removed (part 1).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R61 { a61: number; m61: () => number }
function make61(): R61 { return { a61: 1, m61: () => 1 }; }
function pick61(x: R61): unknown { return x.m61; }
function c61(): void { say("record/picked/includes", [(pick61(make61()))].includes((pick61(make61())))); }

interface R62 { a62: number; m62: () => number }
function make62(): R62 { return { a62: 1, m62: () => 1 }; }
function pick62(x: R62): unknown { return x.m62; }
function c62(): void { say("record/picked/index-of", [(pick62(make62()))].indexOf((pick62(make62())))); }

interface R63 { a63: number; m63: () => number }
function make63(): R63 { return { a63: 1, m63: () => 1 }; }
function pick63(x: R63): unknown { return x.m63; }
const ws63 = new WeakSet<object>();
function c63(): void { say("record/picked/weak-set", (ws63.add((pick63(make63())) as object), ws63.has((pick63(make63())) as object))); }

interface R64 { a64: number; m64: () => number }
function make64(): R64 { return { a64: 1, m64: () => 1 }; }
function pick64(x: R64): unknown { return x.m64; }
const wm64 = new WeakMap<object, number>();`,
      [
        `4(): void { say("record/picked/weak-map", (wm64.set((pick64(make64())) as object, 1), wm64.has((pick64(make64())) as object)
5(): void { say("record/picked/written", ((((pick65(make65()))) as any).tag = 1, (((pick65(make65()))) as any).tag
6(): void { say("record/picked/defined", (Object.defineProperty((pick66(make66())) as object, "t", { value: 1 }), "t" in ((pick66(make66())) as object)
7(): void { say("record/picked/frozen", (Object.freeze((pick67(make67()))), Object.isFrozen((pick67(make67())))
8(): void { say("record/picked/prototype-set", (Object.setPrototypeOf((pick68(make68())) as object, null), Object.getPrototypeOf((pick68(make68()))) === null
9(): void { say("record/picked/deleted", (delete (((pick69(make69()))) as any).length, Object.hasOwn((pick69(make69())) as object, "length")`,
        (n, a) => `function c6${a})); }

interface R${n + 65} { a${n + 65}: number; m${n + 65}: () => number }
function make${n + 65}(): R${n + 65} { return { a${n + 65}: 1, m${n + 65}: () => 1 }; }
function pick${n + 65}(x: R${n + 65}): unknown { return x.m${n + 65}; }`,
      ],
      `function same70(a: unknown, b: unknown): boolean { return a === b; }
function c70(): void { say("record/picked/in-a-callee", same70((pick70(make70())), (pick70(make70())))); }

interface R71 { a71: number; m71: () => number }
function make71(): R71 { return { a71: 1, m71: () => 1 }; }
function pick71(x: R71): unknown { return x.m71; }
function hit71(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c71(): void { say("record/picked/switch", hit71((pick71(make71())), (pick71(make71())))); }

interface R72 { a72: number; m72: () => number }
function make72(): R72 { return { a72: 1, m72: () => 1 }; }
function pick72(x: R72): unknown { return x.m72; }
let last72: unknown;`,
      [
        `seen72(f: unknown): boolean { const same = f === last72; last72 = f; return same	72(): void { say("record/picked/kept-then-compared", (seen72((pick72(make72()))), seen72((pick72(make72()))))
get73(): unknown { return pick73(make73())	73(): void { say("record/picked-and-returned/strict-eq", (get73()) === (get73())
get74(): unknown { return pick74(make74())	74(): void { say("record/picked-and-returned/strict-ne", (get74()) !== (get74())
get75(): unknown { return pick75(make75())	75(): void { say("record/picked-and-returned/loose-eq", (get75()) == (get75())
get76(): unknown { return pick76(make76())	76(): void { say("record/picked-and-returned/object-is", Object.is((get76()), (get76()))
get77(): unknown { return pick77(make77())	77(): void { say("record/picked-and-returned/set", new Set([(get77()), (get77())]).size
get78(): unknown { return pick78(make78())	78(): void { say("record/picked-and-returned/map-key", new Map([[(get78()), 1], [(get78()), 2]]).size
get79(): unknown { return pick79(make79())	79(): void { say("record/picked-and-returned/includes", [(get79())].includes((get79()))
get80(): unknown { return pick80(make80())	80(): void { say("record/picked-and-returned/index-of", [(get80())].indexOf((get80()))`,
        (n, a, b) => `function ${a}; }
function c${b}); }

interface R${n + 73} { a${n + 73}: number; m${n + 73}: () => number }
function make${n + 73}(): R${n + 73} { return { a${n + 73}: 1, m${n + 73}: () => 1 }; }
function pick${n + 73}(x: R${n + 73}): unknown { return x.m${n + 73}; }`,
      ],
      `function get81(): unknown { return pick81(make81()); }
const ws81 = new WeakSet<object>();
function c81(): void { say("record/picked-and-returned/weak-set", (ws81.add((get81()) as object), ws81.has((get81()) as object))); }

interface R82 { a82: number; m82: () => number }
function make82(): R82 { return { a82: 1, m82: () => 1 }; }
function pick82(x: R82): unknown { return x.m82; }
function get82(): unknown { return pick82(make82()); }
const wm82 = new WeakMap<object, number>();`,
      [
        `2(): void { say("record/picked-and-returned/weak-map", (wm82.set((get82()) as object, 1), wm82.has((get82()) as object)
3(): void { say("record/picked-and-returned/written", ((((get83())) as any).tag = 1, (((get83())) as any).tag
4(): void { say("record/picked-and-returned/defined", (Object.defineProperty((get84()) as object, "t", { value: 1 }), "t" in ((get84()) as object)
5(): void { say("record/picked-and-returned/frozen", (Object.freeze((get85())), Object.isFrozen((get85()))
6(): void { say("record/picked-and-returned/prototype-set", (Object.setPrototypeOf((get86()) as object, null), Object.getPrototypeOf((get86())) === null
7(): void { say("record/picked-and-returned/deleted", (delete (((get87())) as any).length, Object.hasOwn((get87()) as object, "length")`,
        (n, a) => `function c8${a})); }

interface R${n + 83} { a${n + 83}: number; m${n + 83}: () => number }
function make${n + 83}(): R${n + 83} { return { a${n + 83}: 1, m${n + 83}: () => 1 }; }
function pick${n + 83}(x: R${n + 83}): unknown { return x.m${n + 83}; }
function get${n + 83}(): unknown { return pick${n + 83}(make${n + 83}()); }`,
      ],
      `function same88(a: unknown, b: unknown): boolean { return a === b; }
function c88(): void { say("record/picked-and-returned/in-a-callee", same88((get88()), (get88()))); }

interface R89 { a89: number; m89: () => number }
function make89(): R89 { return { a89: 1, m89: () => 1 }; }
function pick89(x: R89): unknown { return x.m89; }
function get89(): unknown { return pick89(make89()); }
function hit89(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c89(): void { say("record/picked-and-returned/switch", hit89((get89()), (get89()))); }

interface R90 { a90: number; m90: () => number }
function make90(): R90 { return { a90: 1, m90: () => 1 }; }
function pick90(x: R90): unknown { return x.m90; }`,
      [
        `get90(): unknown { return pick90(make90())	last90	seen90(f: unknown): boolean { const same = f === last90; last90 = f; return same	0(): void { say("record/picked-and-returned/kept-then-compared", (seen90((get90())), seen90((get90())))	1(): void { say("record/variable/strict-eq", ((put91(), slot91)) === ((put91(), slot91	2(): void { say("record/variable/strict-ne", ((put92(), slot92)) !== ((put92(), slot92))
make93(): R93 { return { a93: 1, m93: () => 1 }	slot93	put93(): unknown { slot93 = make93().m93; return 0	3(): void { say("record/variable/loose-eq", ((put93(), slot93)) == ((put93(), slot93))	4(): void { say("record/variable/object-is", Object.is(((put94(), slot94)), ((put94(), slot94)	5(): void { say("record/variable/set", new Set([((put95(), slot95)), ((put95(), slot95))]).size
make96(): R96 { return { a96: 1, m96: () => 1 }	slot96	put96(): unknown { slot96 = make96().m96; return 0	6(): void { say("record/variable/map-key", new Map([[((put96(), slot96)), 1], [((put96(), slot96)), 2]]).size	7(): void { say("record/variable/includes", [((put97(), slot97))].includes(((put97(), slot97)	8(): void { say("record/variable/index-of", [((put98(), slot98))].indexOf(((put98(), slot98)))`,
        (n, a, b, c, d, e, f) => `function ${a}; }
let ${b}: unknown;
function ${c}; }
function c9${d}); }

interface R${3 * n + 91} { a${3 * n + 91}: number; m${3 * n + 91}: () => number }
function make${3 * n + 91}(): R${3 * n + 91} { return { a${3 * n + 91}: 1, m${3 * n + 91}: () => 1 }; }
let slot${3 * n + 91}: unknown;
function put${3 * n + 91}(): unknown { slot${3 * n + 91} = make${3 * n + 91}().m${3 * n + 91}; return 0; }
function c9${e}))); }

interface R${3 * n + 92} { a${3 * n + 92}: number; m${3 * n + 92}: () => number }
function make${3 * n + 92}(): R${3 * n + 92} { return { a${3 * n + 92}: 1, m${3 * n + 92}: () => 1 }; }
let slot${3 * n + 92}: unknown;
function put${3 * n + 92}(): unknown { slot${3 * n + 92} = make${3 * n + 92}().m${3 * n + 92}; return 0; }
function c9${f}); }

interface R${3 * n + 93} { a${3 * n + 93}: number; m${3 * n + 93}: () => number }`,
      ],
      `function make99(): R99 { return { a99: 1, m99: () => 1 }; }
let slot99: unknown;
function put99(): unknown { slot99 = make99().m99; return 0; }
const ws99 = new WeakSet<object>();
function c99(): void { say("record/variable/weak-set", (ws99.add(((put99(), slot99)) as object), ws99.has(((put99(), slot99)) as object))); }

interface R100 { a100: number; m100: () => number }
function make100(): R100 { return { a100: 1, m100: () => 1 }; }
let slot100: unknown;
function put100(): unknown { slot100 = make100().m100; return 0; }
const wm100 = new WeakMap<object, number>();`,
      [
        `0(): void { say("record/variable/weak-map", (wm100.set(((put100(), slot100)) as object, 1), wm100.has(((put100(), slot100)) as object)
1(): void { say("record/variable/written", (((((put101(), slot101))) as any).tag = 1, ((((put101(), slot101))) as any).tag
2(): void { say("record/variable/defined", (Object.defineProperty(((put102(), slot102)) as object, "t", { value: 1 }), "t" in (((put102(), slot102)) as object)
3(): void { say("record/variable/frozen", (Object.freeze(((put103(), slot103))), Object.isFrozen(((put103(), slot103)))
4(): void { say("record/variable/prototype-set", (Object.setPrototypeOf(((put104(), slot104)) as object, null), Object.getPrototypeOf(((put104(), slot104))) === null
5(): void { say("record/variable/deleted", (delete ((((put105(), slot105))) as any).length, Object.hasOwn(((put105(), slot105)) as object, "length")`,
        (n, a) => `function c10${a})); }

interface R${n + 101} { a${n + 101}: number; m${n + 101}: () => number }
function make${n + 101}(): R${n + 101} { return { a${n + 101}: 1, m${n + 101}: () => 1 }; }
let slot${n + 101}: unknown;
function put${n + 101}(): unknown { slot${n + 101} = make${n + 101}().m${n + 101}; return 0; }`,
      ],
      `function same106(a: unknown, b: unknown): boolean { return a === b; }
function c106(): void { say("record/variable/in-a-callee", same106(((put106(), slot106)), ((put106(), slot106)))); }

interface R107 { a107: number; m107: () => number }
function make107(): R107 { return { a107: 1, m107: () => 1 }; }
let slot107: unknown;
function put107(): unknown { slot107 = make107().m107; return 0; }
function hit107(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c107(): void { say("record/variable/switch", hit107(((put107(), slot107)), ((put107(), slot107)))); }

interface R108 { a108: number; m108: () => number }
function make108(): R108 { return { a108: 1, m108: () => 1 }; }
let slot108: unknown;
function put108(): unknown { slot108 = make108().m108; return 0; }
let last108: unknown;`,
      [
        `seen108(f: unknown): boolean { const same = f === last108; last108 = f; return same	08(): void { say("record/variable/kept-then-compared", (seen108(((put108(), slot108))), seen108(((put108(), slot108))))
keep109(): unknown { kept109 = make109(); return 0	09(): void { say("record/holder-in-a-variable/strict-eq", ((keep109(), kept109!.m109)) === ((keep109(), kept109!.m109))
keep110(): unknown { kept110 = make110(); return 0	10(): void { say("record/holder-in-a-variable/strict-ne", ((keep110(), kept110!.m110)) !== ((keep110(), kept110!.m110))
keep111(): unknown { kept111 = make111(); return 0	11(): void { say("record/holder-in-a-variable/loose-eq", ((keep111(), kept111!.m111)) == ((keep111(), kept111!.m111))
keep112(): unknown { kept112 = make112(); return 0	12(): void { say("record/holder-in-a-variable/object-is", Object.is(((keep112(), kept112!.m112)), ((keep112(), kept112!.m112)))
keep113(): unknown { kept113 = make113(); return 0	13(): void { say("record/holder-in-a-variable/set", new Set([((keep113(), kept113!.m113)), ((keep113(), kept113!.m113))]).size
keep114(): unknown { kept114 = make114(); return 0	14(): void { say("record/holder-in-a-variable/map-key", new Map([[((keep114(), kept114!.m114)), 1], [((keep114(), kept114!.m114)), 2]]).size
keep115(): unknown { kept115 = make115(); return 0	15(): void { say("record/holder-in-a-variable/includes", [((keep115(), kept115!.m115))].includes(((keep115(), kept115!.m115)))
keep116(): unknown { kept116 = make116(); return 0	16(): void { say("record/holder-in-a-variable/index-of", [((keep116(), kept116!.m116))].indexOf(((keep116(), kept116!.m116)))`,
        (n, a, b) => `function ${a}; }
function c1${b}); }

interface R${n + 109} { a${n + 109}: number; m${n + 109}: () => number }
function make${n + 109}(): R${n + 109} { return { a${n + 109}: 1, m${n + 109}: () => 1 }; }
let kept${n + 109}: R${n + 109} | undefined;`,
      ],
      `function keep117(): unknown { kept117 = make117(); return 0; }
const ws117 = new WeakSet<object>();
function c117(): void { say("record/holder-in-a-variable/weak-set", (ws117.add(((keep117(), kept117!.m117)) as object), ws117.has(((keep117(), kept117!.m117)) as object))); }

interface R118 { a118: number; m118: () => number }
function make118(): R118 { return { a118: 1, m118: () => 1 }; }
let kept118: R118 | undefined;
function keep118(): unknown { kept118 = make118(); return 0; }
const wm118 = new WeakMap<object, number>();
function c118(): void { say("record/holder-in-a-variable/weak-map", (wm118.set(((keep118(), kept118!.m118)) as object, 1), wm118.has(((keep118(), kept118!.m118)) as object))); }

interface R119 { a119: number; m119: () => number }
function make119(): R119 { return { a119: 1, m119: () => 1 }; }
let kept119: R119 | undefined;
function keep119(): unknown { kept119 = make119(); return 0; }
function c119(): void { say("record/holder-in-a-variable/written", (((((keep119(), kept119!.m119))) as any).tag = 1, ((((keep119(), kept119!.m119))) as any).tag)); }

interface R120 { a120: number; m120: () => number }
function make120(): R120 { return { a120: 1, m120: () => 1 }; }
let kept120: R120 | undefined;
function keep120(): unknown { kept120 = make120(); return 0; }
function c120(): void { say("record/holder-in-a-variable/defined", (Object.defineProperty(((keep120(), kept120!.m120)) as object, "t", { value: 1 }), "t" in (((keep120(), kept120!.m120)) as object))); }

c61(); c62(); c63(); c64(); c65(); c66(); c67(); c68(); c69(); c70(); c71(); c72(); c73(); c74(); c75(); c76(); c77(); c78(); c79(); c80(); c81(); c82(); c83(); c84(); c85(); c86(); c87(); c88(); c89(); c90(); c91(); c92(); c93(); c94(); c95(); c96(); c97(); c98(); c99(); c100(); c101(); c102(); c103(); c104(); c105(); c106(); c107(); c108(); c109(); c110(); c111(); c112(); c113(); c114(); c115(); c116(); c117(); c118(); c119(); c120();
console.log(out.join("\\n"));
`,
    ),
    "identity-03.ts": text(
      `// Generated program: object and closure identity stays observable when allocations are removed (part 3).
declare const console: any;
const out: string[] = [];`,
      [
        `say(name: string, value: unknown): void { out.push(name + "=" + String(value)
c181(): void { say("record/rewrapped/strict-eq", (wrap181().f) === (wrap181().f)
c182(): void { say("record/rewrapped/strict-ne", (wrap182().f) !== (wrap182().f)
c183(): void { say("record/rewrapped/loose-eq", (wrap183().f) == (wrap183().f)
c184(): void { say("record/rewrapped/object-is", Object.is((wrap184().f), (wrap184().f))
c185(): void { say("record/rewrapped/set", new Set([(wrap185().f), (wrap185().f)]).size
c186(): void { say("record/rewrapped/map-key", new Map([[(wrap186().f), 1], [(wrap186().f), 2]]).size
c187(): void { say("record/rewrapped/includes", [(wrap187().f)].includes((wrap187().f))
c188(): void { say("record/rewrapped/index-of", [(wrap188().f)].indexOf((wrap188().f))`,
        (n, a) => `function ${a}); }

interface R${n + 181} { a${n + 181}: number; m${n + 181}: () => number }
function make${n + 181}(): R${n + 181} { return { a${n + 181}: 1, m${n + 181}: () => 1 }; }
function wrap${n + 181}(): { f: unknown } { return { f: make${n + 181}().m${n + 181} }; }`,
      ],
      `const ws189 = new WeakSet<object>();
function c189(): void { say("record/rewrapped/weak-set", (ws189.add((wrap189().f) as object), ws189.has((wrap189().f) as object))); }

interface R190 { a190: number; m190: () => number }
function make190(): R190 { return { a190: 1, m190: () => 1 }; }
function wrap190(): { f: unknown } { return { f: make190().m190 }; }
const wm190 = new WeakMap<object, number>();`,
      [
        `0(): void { say("record/rewrapped/weak-map", (wm190.set((wrap190().f) as object, 1), wm190.has((wrap190().f) as object)
1(): void { say("record/rewrapped/written", ((((wrap191().f)) as any).tag = 1, (((wrap191().f)) as any).tag
2(): void { say("record/rewrapped/defined", (Object.defineProperty((wrap192().f) as object, "t", { value: 1 }), "t" in ((wrap192().f) as object)
3(): void { say("record/rewrapped/frozen", (Object.freeze((wrap193().f)), Object.isFrozen((wrap193().f))
4(): void { say("record/rewrapped/prototype-set", (Object.setPrototypeOf((wrap194().f) as object, null), Object.getPrototypeOf((wrap194().f)) === null
5(): void { say("record/rewrapped/deleted", (delete (((wrap195().f)) as any).length, Object.hasOwn((wrap195().f) as object, "length")`,
        (n, a) => `function c19${a})); }

interface R${n + 191} { a${n + 191}: number; m${n + 191}: () => number }
function make${n + 191}(): R${n + 191} { return { a${n + 191}: 1, m${n + 191}: () => 1 }; }
function wrap${n + 191}(): { f: unknown } { return { f: make${n + 191}().m${n + 191} }; }`,
      ],
      `function same196(a: unknown, b: unknown): boolean { return a === b; }
function c196(): void { say("record/rewrapped/in-a-callee", same196((wrap196().f), (wrap196().f))); }

interface R197 { a197: number; m197: () => number }
function make197(): R197 { return { a197: 1, m197: () => 1 }; }
function wrap197(): { f: unknown } { return { f: make197().m197 }; }
function hit197(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c197(): void { say("record/rewrapped/switch", hit197((wrap197().f), (wrap197().f))); }

interface R198 { a198: number; m198: () => number }
function make198(): R198 { return { a198: 1, m198: () => 1 }; }
function wrap198(): { f: unknown } { return { f: make198().m198 }; }
let last198: unknown;`,
      [
        `seen198(f: unknown): boolean { const same = f === last198; last198 = f; return same	198(): void { say("record/rewrapped/kept-then-compared", (seen198((wrap198().f)), seen198((wrap198().f)))
wrap199(): unknown[] { return [make199().m199]	199(): void { say("record/rewrapped-in-an-array/strict-eq", (wrap199()[0]) === (wrap199()[0])
wrap200(): unknown[] { return [make200().m200]	200(): void { say("record/rewrapped-in-an-array/strict-ne", (wrap200()[0]) !== (wrap200()[0])
wrap201(): unknown[] { return [make201().m201]	201(): void { say("record/rewrapped-in-an-array/loose-eq", (wrap201()[0]) == (wrap201()[0])
wrap202(): unknown[] { return [make202().m202]	202(): void { say("record/rewrapped-in-an-array/object-is", Object.is((wrap202()[0]), (wrap202()[0]))
wrap203(): unknown[] { return [make203().m203]	203(): void { say("record/rewrapped-in-an-array/set", new Set([(wrap203()[0]), (wrap203()[0])]).size
wrap204(): unknown[] { return [make204().m204]	204(): void { say("record/rewrapped-in-an-array/map-key", new Map([[(wrap204()[0]), 1], [(wrap204()[0]), 2]]).size
wrap205(): unknown[] { return [make205().m205]	205(): void { say("record/rewrapped-in-an-array/includes", [(wrap205()[0])].includes((wrap205()[0]))
wrap206(): unknown[] { return [make206().m206]	206(): void { say("record/rewrapped-in-an-array/index-of", [(wrap206()[0])].indexOf((wrap206()[0]))`,
        (n, a, b) => `function ${a}; }
function c${b}); }

interface R${n + 199} { a${n + 199}: number; m${n + 199}: () => number }
function make${n + 199}(): R${n + 199} { return { a${n + 199}: 1, m${n + 199}: () => 1 }; }`,
      ],
      `function wrap207(): unknown[] { return [make207().m207]; }
const ws207 = new WeakSet<object>();
function c207(): void { say("record/rewrapped-in-an-array/weak-set", (ws207.add((wrap207()[0]) as object), ws207.has((wrap207()[0]) as object))); }

interface R208 { a208: number; m208: () => number }
function make208(): R208 { return { a208: 1, m208: () => 1 }; }
function wrap208(): unknown[] { return [make208().m208]; }
const wm208 = new WeakMap<object, number>();`,
      [
        `08(): void { say("record/rewrapped-in-an-array/weak-map", (wm208.set((wrap208()[0]) as object, 1), wm208.has((wrap208()[0]) as object)
09(): void { say("record/rewrapped-in-an-array/written", ((((wrap209()[0])) as any).tag = 1, (((wrap209()[0])) as any).tag
10(): void { say("record/rewrapped-in-an-array/defined", (Object.defineProperty((wrap210()[0]) as object, "t", { value: 1 }), "t" in ((wrap210()[0]) as object)
11(): void { say("record/rewrapped-in-an-array/frozen", (Object.freeze((wrap211()[0])), Object.isFrozen((wrap211()[0]))
12(): void { say("record/rewrapped-in-an-array/prototype-set", (Object.setPrototypeOf((wrap212()[0]) as object, null), Object.getPrototypeOf((wrap212()[0])) === null
13(): void { say("record/rewrapped-in-an-array/deleted", (delete (((wrap213()[0])) as any).length, Object.hasOwn((wrap213()[0]) as object, "length")`,
        (n, a) => `function c2${a})); }

interface R${n + 209} { a${n + 209}: number; m${n + 209}: () => number }
function make${n + 209}(): R${n + 209} { return { a${n + 209}: 1, m${n + 209}: () => 1 }; }
function wrap${n + 209}(): unknown[] { return [make${n + 209}().m${n + 209}]; }`,
      ],
      `function same214(a: unknown, b: unknown): boolean { return a === b; }
function c214(): void { say("record/rewrapped-in-an-array/in-a-callee", same214((wrap214()[0]), (wrap214()[0]))); }

interface R215 { a215: number; m215: () => number }
function make215(): R215 { return { a215: 1, m215: () => 1 }; }
function wrap215(): unknown[] { return [make215().m215]; }
function hit215(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c215(): void { say("record/rewrapped-in-an-array/switch", hit215((wrap215()[0]), (wrap215()[0]))); }

interface R216 { a216: number; m216: () => number }
function make216(): R216 { return { a216: 1, m216: () => 1 }; }
function wrap216(): unknown[] { return [make216().m216]; }
let last216: unknown;
function seen216(f: unknown): boolean { const same = f === last216; last216 = f; return same; }`,
      [
        `16(): void { say("record/rewrapped-in-an-array/kept-then-compared", (seen216((wrap216()[0])), seen216((wrap216()[0])))
17(): void { say("record/generator/strict-eq", (gen217().next().value) === (gen217().next().value)
18(): void { say("record/generator/strict-ne", (gen218().next().value) !== (gen218().next().value)
19(): void { say("record/generator/loose-eq", (gen219().next().value) == (gen219().next().value)
20(): void { say("record/generator/object-is", Object.is((gen220().next().value), (gen220().next().value))
21(): void { say("record/generator/set", new Set([(gen221().next().value), (gen221().next().value)]).size
22(): void { say("record/generator/map-key", new Map([[(gen222().next().value), 1], [(gen222().next().value), 2]]).size
23(): void { say("record/generator/includes", [(gen223().next().value)].includes((gen223().next().value))
24(): void { say("record/generator/index-of", [(gen224().next().value)].indexOf((gen224().next().value))`,
        (n, a) => `function c2${a}); }

interface R${n + 217} { a${n + 217}: number; m${n + 217}: () => number }
function make${n + 217}(): R${n + 217} { return { a${n + 217}: 1, m${n + 217}: () => 1 }; }
function* gen${n + 217}(): Generator<unknown> { yield make${n + 217}().m${n + 217}; }`,
      ],
      `const ws225 = new WeakSet<object>();
function c225(): void { say("record/generator/weak-set", (ws225.add((gen225().next().value) as object), ws225.has((gen225().next().value) as object))); }

interface R226 { a226: number; m226: () => number }
function make226(): R226 { return { a226: 1, m226: () => 1 }; }
function* gen226(): Generator<unknown> { yield make226().m226; }
const wm226 = new WeakMap<object, number>();`,
      [
        `26(): void { say("record/generator/weak-map", (wm226.set((gen226().next().value) as object, 1), wm226.has((gen226().next().value) as object)
27(): void { say("record/generator/written", ((((gen227().next().value)) as any).tag = 1, (((gen227().next().value)) as any).tag
28(): void { say("record/generator/defined", (Object.defineProperty((gen228().next().value) as object, "t", { value: 1 }), "t" in ((gen228().next().value) as object)
29(): void { say("record/generator/frozen", (Object.freeze((gen229().next().value)), Object.isFrozen((gen229().next().value))
30(): void { say("record/generator/prototype-set", (Object.setPrototypeOf((gen230().next().value) as object, null), Object.getPrototypeOf((gen230().next().value)) === null
31(): void { say("record/generator/deleted", (delete (((gen231().next().value)) as any).length, Object.hasOwn((gen231().next().value) as object, "length")`,
        (n, a) => `function c2${a})); }

interface R${n + 227} { a${n + 227}: number; m${n + 227}: () => number }
function make${n + 227}(): R${n + 227} { return { a${n + 227}: 1, m${n + 227}: () => 1 }; }
function* gen${n + 227}(): Generator<unknown> { yield make${n + 227}().m${n + 227}; }`,
      ],
      `function same232(a: unknown, b: unknown): boolean { return a === b; }
function c232(): void { say("record/generator/in-a-callee", same232((gen232().next().value), (gen232().next().value))); }

interface R233 { a233: number; m233: () => number }
function make233(): R233 { return { a233: 1, m233: () => 1 }; }
function* gen233(): Generator<unknown> { yield make233().m233; }
function hit233(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c233(): void { say("record/generator/switch", hit233((gen233().next().value), (gen233().next().value))); }

interface R234 { a234: number; m234: () => number }
function make234(): R234 { return { a234: 1, m234: () => 1 }; }
function* gen234(): Generator<unknown> { yield make234().m234; }
let last234: unknown;
function seen234(f: unknown): boolean { const same = f === last234; last234 = f; return same; }`,
      [
        `4(): void { say("record/generator/kept-then-compared", (seen234((gen234().next().value)), seen234((gen234().next().value)))
5(): void { say("record/method/strict-eq", (new K235().get()) === (new K235().get())
6(): void { say("record/method/strict-ne", (new K236().get()) !== (new K236().get())
7(): void { say("record/method/loose-eq", (new K237().get()) == (new K237().get())
8(): void { say("record/method/object-is", Object.is((new K238().get()), (new K238().get()))
9(): void { say("record/method/set", new Set([(new K239().get()), (new K239().get())]).size`,
        (n, a) => `function c23${a}); }

interface R${n + 235} { a${n + 235}: number; m${n + 235}: () => number }
function make${n + 235}(): R${n + 235} { return { a${n + 235}: 1, m${n + 235}: () => 1 }; }
class K${n + 235} { get(): unknown { return make${n + 235}().m${n + 235}; } }`,
      ],
      `function c240(): void { say("record/method/map-key", new Map([[(new K240().get()), 1], [(new K240().get()), 2]]).size); }

c181(); c182(); c183(); c184(); c185(); c186(); c187(); c188(); c189(); c190(); c191(); c192(); c193(); c194(); c195(); c196(); c197(); c198(); c199(); c200(); c201(); c202(); c203(); c204(); c205(); c206(); c207(); c208(); c209(); c210(); c211(); c212(); c213(); c214(); c215(); c216(); c217(); c218(); c219(); c220(); c221(); c222(); c223(); c224(); c225(); c226(); c227(); c228(); c229(); c230(); c231(); c232(); c233(); c234(); c235(); c236(); c237(); c238(); c239(); c240();
console.log(out.join("\\n"));
`,
    ),
    "identity-04.ts": text(
      `// Generated program: object and closure identity stays observable when allocations are removed (part 4).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R241 { a241: number; m241: () => number }
function make241(): R241 { return { a241: 1, m241: () => 1 }; }
class K241 { get(): unknown { return make241().m241; } }
function c241(): void { say("record/method/includes", [(new K241().get())].includes((new K241().get()))); }

interface R242 { a242: number; m242: () => number }
function make242(): R242 { return { a242: 1, m242: () => 1 }; }
class K242 { get(): unknown { return make242().m242; } }
function c242(): void { say("record/method/index-of", [(new K242().get())].indexOf((new K242().get()))); }

interface R243 { a243: number; m243: () => number }
function make243(): R243 { return { a243: 1, m243: () => 1 }; }
class K243 { get(): unknown { return make243().m243; } }
const ws243 = new WeakSet<object>();
function c243(): void { say("record/method/weak-set", (ws243.add((new K243().get()) as object), ws243.has((new K243().get()) as object))); }

interface R244 { a244: number; m244: () => number }
function make244(): R244 { return { a244: 1, m244: () => 1 }; }
class K244 { get(): unknown { return make244().m244; } }
const wm244 = new WeakMap<object, number>();`,
      [
        `4(): void { say("record/method/weak-map", (wm244.set((new K244().get()) as object, 1), wm244.has((new K244().get()) as object)
5(): void { say("record/method/written", ((((new K245().get())) as any).tag = 1, (((new K245().get())) as any).tag
6(): void { say("record/method/defined", (Object.defineProperty((new K246().get()) as object, "t", { value: 1 }), "t" in ((new K246().get()) as object)
7(): void { say("record/method/frozen", (Object.freeze((new K247().get())), Object.isFrozen((new K247().get()))
8(): void { say("record/method/prototype-set", (Object.setPrototypeOf((new K248().get()) as object, null), Object.getPrototypeOf((new K248().get())) === null
9(): void { say("record/method/deleted", (delete (((new K249().get())) as any).length, Object.hasOwn((new K249().get()) as object, "length")`,
        (n, a) => `function c24${a})); }

interface R${n + 245} { a${n + 245}: number; m${n + 245}: () => number }
function make${n + 245}(): R${n + 245} { return { a${n + 245}: 1, m${n + 245}: () => 1 }; }
class K${n + 245} { get(): unknown { return make${n + 245}().m${n + 245}; } }`,
      ],
      `function same250(a: unknown, b: unknown): boolean { return a === b; }
function c250(): void { say("record/method/in-a-callee", same250((new K250().get()), (new K250().get()))); }

interface R251 { a251: number; m251: () => number }
function make251(): R251 { return { a251: 1, m251: () => 1 }; }
class K251 { get(): unknown { return make251().m251; } }
function hit251(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c251(): void { say("record/method/switch", hit251((new K251().get()), (new K251().get()))); }

interface R252 { a252: number; m252: () => number }
function make252(): R252 { return { a252: 1, m252: () => 1 }; }
class K252 { get(): unknown { return make252().m252; } }
let last252: unknown;
function seen252(f: unknown): boolean { const same = f === last252; last252 = f; return same; }`,
      [
        `52(): void { say("record/method/kept-then-compared", (seen252((new K252().get())), seen252((new K252().get())))
53(): void { say("record/accessor/strict-eq", (new K253().f) === (new K253().f)
54(): void { say("record/accessor/strict-ne", (new K254().f) !== (new K254().f)
55(): void { say("record/accessor/loose-eq", (new K255().f) == (new K255().f)
56(): void { say("record/accessor/object-is", Object.is((new K256().f), (new K256().f))
57(): void { say("record/accessor/set", new Set([(new K257().f), (new K257().f)]).size
58(): void { say("record/accessor/map-key", new Map([[(new K258().f), 1], [(new K258().f), 2]]).size
59(): void { say("record/accessor/includes", [(new K259().f)].includes((new K259().f))
60(): void { say("record/accessor/index-of", [(new K260().f)].indexOf((new K260().f))`,
        (n, a) => `function c2${a}); }

interface R${n + 253} { a${n + 253}: number; m${n + 253}: () => number }
function make${n + 253}(): R${n + 253} { return { a${n + 253}: 1, m${n + 253}: () => 1 }; }
class K${n + 253} { get f(): unknown { return make${n + 253}().m${n + 253}; } }`,
      ],
      `const ws261 = new WeakSet<object>();
function c261(): void { say("record/accessor/weak-set", (ws261.add((new K261().f) as object), ws261.has((new K261().f) as object))); }

interface R262 { a262: number; m262: () => number }
function make262(): R262 { return { a262: 1, m262: () => 1 }; }
class K262 { get f(): unknown { return make262().m262; } }
const wm262 = new WeakMap<object, number>();`,
      [
        `2(): void { say("record/accessor/weak-map", (wm262.set((new K262().f) as object, 1), wm262.has((new K262().f) as object)
3(): void { say("record/accessor/written", ((((new K263().f)) as any).tag = 1, (((new K263().f)) as any).tag
4(): void { say("record/accessor/defined", (Object.defineProperty((new K264().f) as object, "t", { value: 1 }), "t" in ((new K264().f) as object)
5(): void { say("record/accessor/frozen", (Object.freeze((new K265().f)), Object.isFrozen((new K265().f))
6(): void { say("record/accessor/prototype-set", (Object.setPrototypeOf((new K266().f) as object, null), Object.getPrototypeOf((new K266().f)) === null
7(): void { say("record/accessor/deleted", (delete (((new K267().f)) as any).length, Object.hasOwn((new K267().f) as object, "length")`,
        (n, a) => `function c26${a})); }

interface R${n + 263} { a${n + 263}: number; m${n + 263}: () => number }
function make${n + 263}(): R${n + 263} { return { a${n + 263}: 1, m${n + 263}: () => 1 }; }
class K${n + 263} { get f(): unknown { return make${n + 263}().m${n + 263}; } }`,
      ],
      `function same268(a: unknown, b: unknown): boolean { return a === b; }
function c268(): void { say("record/accessor/in-a-callee", same268((new K268().f), (new K268().f))); }

interface R269 { a269: number; m269: () => number }
function make269(): R269 { return { a269: 1, m269: () => 1 }; }
class K269 { get f(): unknown { return make269().m269; } }
function hit269(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c269(): void { say("record/accessor/switch", hit269((new K269().f), (new K269().f))); }

interface R270 { a270: number; m270: () => number }
function make270(): R270 { return { a270: 1, m270: () => 1 }; }
class K270 { get f(): unknown { return make270().m270; } }
let last270: unknown;`,
      [
        `seen270(f: unknown): boolean { const same = f === last270; last270 = f; return same	0(): void { say("record/accessor/kept-then-compared", (seen270((new K270().f)), seen270((new K270().f)))
first271(...xs: unknown[]): unknown { return xs[0]	1(): void { say("record/rest/strict-eq", (first271(make271().m271)) === (first271(make271().m271))
first272(...xs: unknown[]): unknown { return xs[0]	2(): void { say("record/rest/strict-ne", (first272(make272().m272)) !== (first272(make272().m272))
first273(...xs: unknown[]): unknown { return xs[0]	3(): void { say("record/rest/loose-eq", (first273(make273().m273)) == (first273(make273().m273))
first274(...xs: unknown[]): unknown { return xs[0]	4(): void { say("record/rest/object-is", Object.is((first274(make274().m274)), (first274(make274().m274)))
first275(...xs: unknown[]): unknown { return xs[0]	5(): void { say("record/rest/set", new Set([(first275(make275().m275)), (first275(make275().m275))]).size
first276(...xs: unknown[]): unknown { return xs[0]	6(): void { say("record/rest/map-key", new Map([[(first276(make276().m276)), 1], [(first276(make276().m276)), 2]]).size
first277(...xs: unknown[]): unknown { return xs[0]	7(): void { say("record/rest/includes", [(first277(make277().m277))].includes((first277(make277().m277)))
first278(...xs: unknown[]): unknown { return xs[0]	8(): void { say("record/rest/index-of", [(first278(make278().m278))].indexOf((first278(make278().m278)))`,
        (n, a, b) => `function ${a}; }
function c27${b}); }

interface R${n + 271} { a${n + 271}: number; m${n + 271}: () => number }
function make${n + 271}(): R${n + 271} { return { a${n + 271}: 1, m${n + 271}: () => 1 }; }`,
      ],
      `function first279(...xs: unknown[]): unknown { return xs[0]; }
const ws279 = new WeakSet<object>();
function c279(): void { say("record/rest/weak-set", (ws279.add((first279(make279().m279)) as object), ws279.has((first279(make279().m279)) as object))); }

interface R280 { a280: number; m280: () => number }
function make280(): R280 { return { a280: 1, m280: () => 1 }; }
function first280(...xs: unknown[]): unknown { return xs[0]; }
const wm280 = new WeakMap<object, number>();`,
      [
        `0(): void { say("record/rest/weak-map", (wm280.set((first280(make280().m280)) as object, 1), wm280.has((first280(make280().m280)) as object)
1(): void { say("record/rest/written", ((((first281(make281().m281))) as any).tag = 1, (((first281(make281().m281))) as any).tag
2(): void { say("record/rest/defined", (Object.defineProperty((first282(make282().m282)) as object, "t", { value: 1 }), "t" in ((first282(make282().m282)) as object)
3(): void { say("record/rest/frozen", (Object.freeze((first283(make283().m283))), Object.isFrozen((first283(make283().m283)))
4(): void { say("record/rest/prototype-set", (Object.setPrototypeOf((first284(make284().m284)) as object, null), Object.getPrototypeOf((first284(make284().m284))) === null
5(): void { say("record/rest/deleted", (delete (((first285(make285().m285))) as any).length, Object.hasOwn((first285(make285().m285)) as object, "length")`,
        (n, a) => `function c28${a})); }

interface R${n + 281} { a${n + 281}: number; m${n + 281}: () => number }
function make${n + 281}(): R${n + 281} { return { a${n + 281}: 1, m${n + 281}: () => 1 }; }
function first${n + 281}(...xs: unknown[]): unknown { return xs[0]; }`,
      ],
      `function same286(a: unknown, b: unknown): boolean { return a === b; }
function c286(): void { say("record/rest/in-a-callee", same286((first286(make286().m286)), (first286(make286().m286)))); }

interface R287 { a287: number; m287: () => number }
function make287(): R287 { return { a287: 1, m287: () => 1 }; }
function first287(...xs: unknown[]): unknown { return xs[0]; }
function hit287(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c287(): void { say("record/rest/switch", hit287((first287(make287().m287)), (first287(make287().m287)))); }

interface R288 { a288: number; m288: () => number }
function make288(): R288 { return { a288: 1, m288: () => 1 }; }
function first288(...xs: unknown[]): unknown { return xs[0]; }
let last288: unknown;
function seen288(f: unknown): boolean { const same = f === last288; last288 = f; return same; }`,
      [
        `88(): void { say("record/rest/kept-then-compared", (seen288((first288(make288().m288))), seen288((first288(make288().m288))))
89(): void { say("record/thrown/strict-eq", (get289()) === (get289())
90(): void { say("record/thrown/strict-ne", (get290()) !== (get290())
91(): void { say("record/thrown/loose-eq", (get291()) == (get291())
92(): void { say("record/thrown/object-is", Object.is((get292()), (get292()))
93(): void { say("record/thrown/set", new Set([(get293()), (get293())]).size
94(): void { say("record/thrown/map-key", new Map([[(get294()), 1], [(get294()), 2]]).size
95(): void { say("record/thrown/includes", [(get295())].includes((get295()))
96(): void { say("record/thrown/index-of", [(get296())].indexOf((get296()))`,
        (n, a) => `function c2${a}); }

interface R${n + 289} { a${n + 289}: number; m${n + 289}: () => number }
function make${n + 289}(): R${n + 289} { return { a${n + 289}: 1, m${n + 289}: () => 1 }; }
function get${n + 289}(): unknown { try { throw make${n + 289}().m${n + 289}; } catch (e) { return e; } }`,
      ],
      `const ws297 = new WeakSet<object>();
function c297(): void { say("record/thrown/weak-set", (ws297.add((get297()) as object), ws297.has((get297()) as object))); }

interface R298 { a298: number; m298: () => number }
function make298(): R298 { return { a298: 1, m298: () => 1 }; }
function get298(): unknown { try { throw make298().m298; } catch (e) { return e; } }
const wm298 = new WeakMap<object, number>();
function c298(): void { say("record/thrown/weak-map", (wm298.set((get298()) as object, 1), wm298.has((get298()) as object))); }

interface R299 { a299: number; m299: () => number }
function make299(): R299 { return { a299: 1, m299: () => 1 }; }
function get299(): unknown { try { throw make299().m299; } catch (e) { return e; } }
function c299(): void { say("record/thrown/written", ((((get299())) as any).tag = 1, (((get299())) as any).tag)); }

interface R300 { a300: number; m300: () => number }
function make300(): R300 { return { a300: 1, m300: () => 1 }; }
function get300(): unknown { try { throw make300().m300; } catch (e) { return e; } }
function c300(): void { say("record/thrown/defined", (Object.defineProperty((get300()) as object, "t", { value: 1 }), "t" in ((get300()) as object))); }

c241(); c242(); c243(); c244(); c245(); c246(); c247(); c248(); c249(); c250(); c251(); c252(); c253(); c254(); c255(); c256(); c257(); c258(); c259(); c260(); c261(); c262(); c263(); c264(); c265(); c266(); c267(); c268(); c269(); c270(); c271(); c272(); c273(); c274(); c275(); c276(); c277(); c278(); c279(); c280(); c281(); c282(); c283(); c284(); c285(); c286(); c287(); c288(); c289(); c290(); c291(); c292(); c293(); c294(); c295(); c296(); c297(); c298(); c299(); c300();
console.log(out.join("\\n"));
`,
    ),
    "identity-05.ts": text(
      `// Generated program: object and closure identity stays observable when allocations are removed (part 5).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R301 { a301: number; m301: () => number }
function make301(): R301 { return { a301: 1, m301: () => 1 }; }
function get301(): unknown { try { throw make301().m301; } catch (e) { return e; } }
function c301(): void { say("record/thrown/frozen", (Object.freeze((get301())), Object.isFrozen((get301())))); }

interface R302 { a302: number; m302: () => number }
function make302(): R302 { return { a302: 1, m302: () => 1 }; }
function get302(): unknown { try { throw make302().m302; } catch (e) { return e; } }
function c302(): void { say("record/thrown/prototype-set", (Object.setPrototypeOf((get302()) as object, null), Object.getPrototypeOf((get302())) === null)); }

interface R303 { a303: number; m303: () => number }
function make303(): R303 { return { a303: 1, m303: () => 1 }; }
function get303(): unknown { try { throw make303().m303; } catch (e) { return e; } }
function c303(): void { say("record/thrown/deleted", (delete (((get303())) as any).length, Object.hasOwn((get303()) as object, "length"))); }

interface R304 { a304: number; m304: () => number }
function make304(): R304 { return { a304: 1, m304: () => 1 }; }
function get304(): unknown { try { throw make304().m304; } catch (e) { return e; } }
function same304(a: unknown, b: unknown): boolean { return a === b; }
function c304(): void { say("record/thrown/in-a-callee", same304((get304()), (get304()))); }

interface R305 { a305: number; m305: () => number }
function make305(): R305 { return { a305: 1, m305: () => 1 }; }
function get305(): unknown { try { throw make305().m305; } catch (e) { return e; } }
function hit305(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c305(): void { say("record/thrown/switch", hit305((get305()), (get305()))); }

interface R306 { a306: number; m306: () => number }
function make306(): R306 { return { a306: 1, m306: () => 1 }; }
function get306(): unknown { try { throw make306().m306; } catch (e) { return e; } }
let last306: unknown;`,
      [
        `seen306(f: unknown): boolean { const same = f === last306; last306 = f; return same	06(): void { say("record/thrown/kept-then-compared", (seen306((get306())), seen306((get306())))
get307(other: unknown, which: boolean): unknown { return which ? make307().m307 : other	07(): void { say("record/one-arm/strict-eq", (get307(0, true)) === (get307(0, true))
get308(other: unknown, which: boolean): unknown { return which ? make308().m308 : other	08(): void { say("record/one-arm/strict-ne", (get308(0, true)) !== (get308(0, true))
get309(other: unknown, which: boolean): unknown { return which ? make309().m309 : other	09(): void { say("record/one-arm/loose-eq", (get309(0, true)) == (get309(0, true))
get310(other: unknown, which: boolean): unknown { return which ? make310().m310 : other	10(): void { say("record/one-arm/object-is", Object.is((get310(0, true)), (get310(0, true)))
get311(other: unknown, which: boolean): unknown { return which ? make311().m311 : other	11(): void { say("record/one-arm/set", new Set([(get311(0, true)), (get311(0, true))]).size
get312(other: unknown, which: boolean): unknown { return which ? make312().m312 : other	12(): void { say("record/one-arm/map-key", new Map([[(get312(0, true)), 1], [(get312(0, true)), 2]]).size
get313(other: unknown, which: boolean): unknown { return which ? make313().m313 : other	13(): void { say("record/one-arm/includes", [(get313(0, true))].includes((get313(0, true)))
get314(other: unknown, which: boolean): unknown { return which ? make314().m314 : other	14(): void { say("record/one-arm/index-of", [(get314(0, true))].indexOf((get314(0, true)))`,
        (n, a, b) => `function ${a}; }
function c3${b}); }

interface R${n + 307} { a${n + 307}: number; m${n + 307}: () => number }
function make${n + 307}(): R${n + 307} { return { a${n + 307}: 1, m${n + 307}: () => 1 }; }`,
      ],
      `function get315(other: unknown, which: boolean): unknown { return which ? make315().m315 : other; }
const ws315 = new WeakSet<object>();
function c315(): void { say("record/one-arm/weak-set", (ws315.add((get315(0, true)) as object), ws315.has((get315(0, true)) as object))); }

interface R316 { a316: number; m316: () => number }
function make316(): R316 { return { a316: 1, m316: () => 1 }; }
function get316(other: unknown, which: boolean): unknown { return which ? make316().m316 : other; }
const wm316 = new WeakMap<object, number>();`,
      [
        `16(): void { say("record/one-arm/weak-map", (wm316.set((get316(0, true)) as object, 1), wm316.has((get316(0, true)) as object)
17(): void { say("record/one-arm/written", ((((get317(0, true))) as any).tag = 1, (((get317(0, true))) as any).tag
18(): void { say("record/one-arm/defined", (Object.defineProperty((get318(0, true)) as object, "t", { value: 1 }), "t" in ((get318(0, true)) as object)
19(): void { say("record/one-arm/frozen", (Object.freeze((get319(0, true))), Object.isFrozen((get319(0, true)))
20(): void { say("record/one-arm/prototype-set", (Object.setPrototypeOf((get320(0, true)) as object, null), Object.getPrototypeOf((get320(0, true))) === null
21(): void { say("record/one-arm/deleted", (delete (((get321(0, true))) as any).length, Object.hasOwn((get321(0, true)) as object, "length")`,
        (n, a) => `function c3${a})); }

interface R${n + 317} { a${n + 317}: number; m${n + 317}: () => number }
function make${n + 317}(): R${n + 317} { return { a${n + 317}: 1, m${n + 317}: () => 1 }; }
function get${n + 317}(other: unknown, which: boolean): unknown { return which ? make${n + 317}().m${n + 317} : other; }`,
      ],
      `function same322(a: unknown, b: unknown): boolean { return a === b; }
function c322(): void { say("record/one-arm/in-a-callee", same322((get322(0, true)), (get322(0, true)))); }

interface R323 { a323: number; m323: () => number }
function make323(): R323 { return { a323: 1, m323: () => 1 }; }
function get323(other: unknown, which: boolean): unknown { return which ? make323().m323 : other; }
function hit323(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c323(): void { say("record/one-arm/switch", hit323((get323(0, true)), (get323(0, true)))); }

interface R324 { a324: number; m324: () => number }
function make324(): R324 { return { a324: 1, m324: () => 1 }; }
function get324(other: unknown, which: boolean): unknown { return which ? make324().m324 : other; }
let last324: unknown;`,
      [
        `seen324(f: unknown): boolean { const same = f === last324; last324 = f; return same	24(): void { say("record/one-arm/kept-then-compared", (seen324((get324(0, true))), seen324((get324(0, true))))
get325(): unknown { let t = make325(); for (let i = 0; i < 2; i++) t = make325(); return t.m325	25(): void { say("record/loop/strict-eq", (get325()) === (get325())
get326(): unknown { let t = make326(); for (let i = 0; i < 2; i++) t = make326(); return t.m326	26(): void { say("record/loop/strict-ne", (get326()) !== (get326())
get327(): unknown { let t = make327(); for (let i = 0; i < 2; i++) t = make327(); return t.m327	27(): void { say("record/loop/loose-eq", (get327()) == (get327())
get328(): unknown { let t = make328(); for (let i = 0; i < 2; i++) t = make328(); return t.m328	28(): void { say("record/loop/object-is", Object.is((get328()), (get328()))
get329(): unknown { let t = make329(); for (let i = 0; i < 2; i++) t = make329(); return t.m329	29(): void { say("record/loop/set", new Set([(get329()), (get329())]).size
get330(): unknown { let t = make330(); for (let i = 0; i < 2; i++) t = make330(); return t.m330	30(): void { say("record/loop/map-key", new Map([[(get330()), 1], [(get330()), 2]]).size
get331(): unknown { let t = make331(); for (let i = 0; i < 2; i++) t = make331(); return t.m331	31(): void { say("record/loop/includes", [(get331())].includes((get331()))
get332(): unknown { let t = make332(); for (let i = 0; i < 2; i++) t = make332(); return t.m332	32(): void { say("record/loop/index-of", [(get332())].indexOf((get332()))`,
        (n, a, b) => `function ${a}; }
function c3${b}); }

interface R${n + 325} { a${n + 325}: number; m${n + 325}: () => number }
function make${n + 325}(): R${n + 325} { return { a${n + 325}: 1, m${n + 325}: () => 1 }; }`,
      ],
      `function get333(): unknown { let t = make333(); for (let i = 0; i < 2; i++) t = make333(); return t.m333; }
const ws333 = new WeakSet<object>();
function c333(): void { say("record/loop/weak-set", (ws333.add((get333()) as object), ws333.has((get333()) as object))); }

interface R334 { a334: number; m334: () => number }
function make334(): R334 { return { a334: 1, m334: () => 1 }; }
function get334(): unknown { let t = make334(); for (let i = 0; i < 2; i++) t = make334(); return t.m334; }
const wm334 = new WeakMap<object, number>();`,
      [
        `4(): void { say("record/loop/weak-map", (wm334.set((get334()) as object, 1), wm334.has((get334()) as object)
5(): void { say("record/loop/written", ((((get335())) as any).tag = 1, (((get335())) as any).tag
6(): void { say("record/loop/defined", (Object.defineProperty((get336()) as object, "t", { value: 1 }), "t" in ((get336()) as object)
7(): void { say("record/loop/frozen", (Object.freeze((get337())), Object.isFrozen((get337()))
8(): void { say("record/loop/prototype-set", (Object.setPrototypeOf((get338()) as object, null), Object.getPrototypeOf((get338())) === null
9(): void { say("record/loop/deleted", (delete (((get339())) as any).length, Object.hasOwn((get339()) as object, "length")`,
        (n, a) => `function c33${a})); }

interface R${n + 335} { a${n + 335}: number; m${n + 335}: () => number }
function make${n + 335}(): R${n + 335} { return { a${n + 335}: 1, m${n + 335}: () => 1 }; }
function get${n + 335}(): unknown { let t = make${n + 335}(); for (let i = 0; i < 2; i++) t = make${n + 335}(); return t.m${n + 335}; }`,
      ],
      `function same340(a: unknown, b: unknown): boolean { return a === b; }
function c340(): void { say("record/loop/in-a-callee", same340((get340()), (get340()))); }

interface R341 { a341: number; m341: () => number }
function make341(): R341 { return { a341: 1, m341: () => 1 }; }
function get341(): unknown { let t = make341(); for (let i = 0; i < 2; i++) t = make341(); return t.m341; }
function hit341(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c341(): void { say("record/loop/switch", hit341((get341()), (get341()))); }

interface R342 { a342: number; m342: () => number }
function make342(): R342 { return { a342: 1, m342: () => 1 }; }
function get342(): unknown { let t = make342(); for (let i = 0; i < 2; i++) t = make342(); return t.m342; }
let last342: unknown;`,
      [
        `seen342(f: unknown): boolean { const same = f === last342; last342 = f; return same	42(): void { say("record/loop/kept-then-compared", (seen342((get342())), seen342((get342())))
get343(): unknown { return id343(make343()).m343	43(): void { say("record/identity/strict-eq", (get343()) === (get343())
get344(): unknown { return id344(make344()).m344	44(): void { say("record/identity/strict-ne", (get344()) !== (get344())
get345(): unknown { return id345(make345()).m345	45(): void { say("record/identity/loose-eq", (get345()) == (get345())
get346(): unknown { return id346(make346()).m346	46(): void { say("record/identity/object-is", Object.is((get346()), (get346()))
get347(): unknown { return id347(make347()).m347	47(): void { say("record/identity/set", new Set([(get347()), (get347())]).size
get348(): unknown { return id348(make348()).m348	48(): void { say("record/identity/map-key", new Map([[(get348()), 1], [(get348()), 2]]).size
get349(): unknown { return id349(make349()).m349	49(): void { say("record/identity/includes", [(get349())].includes((get349()))
get350(): unknown { return id350(make350()).m350	50(): void { say("record/identity/index-of", [(get350())].indexOf((get350()))`,
        (n, a, b) => `function ${a}; }
function c3${b}); }

interface R${n + 343} { a${n + 343}: number; m${n + 343}: () => number }
function make${n + 343}(): R${n + 343} { return { a${n + 343}: 1, m${n + 343}: () => 1 }; }
function id${n + 343}<T>(x: T): T { return x; }`,
      ],
      `function get351(): unknown { return id351(make351()).m351; }
const ws351 = new WeakSet<object>();
function c351(): void { say("record/identity/weak-set", (ws351.add((get351()) as object), ws351.has((get351()) as object))); }

interface R352 { a352: number; m352: () => number }
function make352(): R352 { return { a352: 1, m352: () => 1 }; }
function id352<T>(x: T): T { return x; }
function get352(): unknown { return id352(make352()).m352; }
const wm352 = new WeakMap<object, number>();`,
      [
        `2(): void { say("record/identity/weak-map", (wm352.set((get352()) as object, 1), wm352.has((get352()) as object)
3(): void { say("record/identity/written", ((((get353())) as any).tag = 1, (((get353())) as any).tag
4(): void { say("record/identity/defined", (Object.defineProperty((get354()) as object, "t", { value: 1 }), "t" in ((get354()) as object)
5(): void { say("record/identity/frozen", (Object.freeze((get355())), Object.isFrozen((get355()))
6(): void { say("record/identity/prototype-set", (Object.setPrototypeOf((get356()) as object, null), Object.getPrototypeOf((get356())) === null
7(): void { say("record/identity/deleted", (delete (((get357())) as any).length, Object.hasOwn((get357()) as object, "length")`,
        (n, a) => `function c35${a})); }

interface R${n + 353} { a${n + 353}: number; m${n + 353}: () => number }
function make${n + 353}(): R${n + 353} { return { a${n + 353}: 1, m${n + 353}: () => 1 }; }
function id${n + 353}<T>(x: T): T { return x; }
function get${n + 353}(): unknown { return id${n + 353}(make${n + 353}()).m${n + 353}; }`,
      ],
      `function same358(a: unknown, b: unknown): boolean { return a === b; }
function c358(): void { say("record/identity/in-a-callee", same358((get358()), (get358()))); }

interface R359 { a359: number; m359: () => number }
function make359(): R359 { return { a359: 1, m359: () => 1 }; }
function id359<T>(x: T): T { return x; }
function get359(): unknown { return id359(make359()).m359; }
function hit359(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c359(): void { say("record/identity/switch", hit359((get359()), (get359()))); }

interface R360 { a360: number; m360: () => number }
function make360(): R360 { return { a360: 1, m360: () => 1 }; }
function id360<T>(x: T): T { return x; }
function get360(): unknown { return id360(make360()).m360; }
let last360: unknown;
function seen360(f: unknown): boolean { const same = f === last360; last360 = f; return same; }
function c360(): void { say("record/identity/kept-then-compared", (seen360((get360())), seen360((get360())))); }

c301(); c302(); c303(); c304(); c305(); c306(); c307(); c308(); c309(); c310(); c311(); c312(); c313(); c314(); c315(); c316(); c317(); c318(); c319(); c320(); c321(); c322(); c323(); c324(); c325(); c326(); c327(); c328(); c329(); c330(); c331(); c332(); c333(); c334(); c335(); c336(); c337(); c338(); c339(); c340(); c341(); c342(); c343(); c344(); c345(); c346(); c347(); c348(); c349(); c350(); c351(); c352(); c353(); c354(); c355(); c356(); c357(); c358(); c359(); c360();
console.log(out.join("\\n"));
`,
    ),
    "identity2-00.ts": text(
      `// Generated program: object and closure identity stays observable when allocations are removed (second series, part 0).
declare const console: any;
const out: string[] = [];`,
      [
        `say(name: string, value: unknown): void { out.push(name + "=" + String(value)
c1(): void { say("record/private-field/strict-eq", (new K1().get()) === (new K1().get())
c2(): void { say("record/private-field/strict-ne", (new K2().get()) !== (new K2().get())
c3(): void { say("record/private-field/loose-eq", (new K3().get()) == (new K3().get())
c4(): void { say("record/private-field/object-is", Object.is((new K4().get()), (new K4().get()))
c5(): void { say("record/private-field/set", new Set([(new K5().get()), (new K5().get())]).size
c6(): void { say("record/private-field/map-key", new Map([[(new K6().get()), 1], [(new K6().get()), 2]]).size
c7(): void { say("record/private-field/includes", [(new K7().get())].includes((new K7().get()))
c8(): void { say("record/private-field/index-of", [(new K8().get())].indexOf((new K8().get()))`,
        (n, a) => `function ${a}); }

interface R${n + 1} { a${n + 1}: number; m${n + 1}: () => number }
function make${n + 1}(): R${n + 1} { return { a${n + 1}: 1, m${n + 1}: () => 1 }; }
class K${n + 1} { #f: unknown; constructor() { this.#f = make${n + 1}().m${n + 1}; } get(): unknown { return this.#f; } }`,
      ],
      `const ws9 = new WeakSet<object>();
function c9(): void { say("record/private-field/weak-set", (ws9.add((new K9().get()) as object), ws9.has((new K9().get()) as object))); }

interface R10 { a10: number; m10: () => number }
function make10(): R10 { return { a10: 1, m10: () => 1 }; }
class K10 { #f: unknown; constructor() { this.#f = make10().m10; } get(): unknown { return this.#f; } }
const wm10 = new WeakMap<object, number>();`,
      [
        `0(): void { say("record/private-field/weak-map", (wm10.set((new K10().get()) as object, 1), wm10.has((new K10().get()) as object)
1(): void { say("record/private-field/written", ((((new K11().get())) as any).tag = 1, (((new K11().get())) as any).tag
2(): void { say("record/private-field/defined", (Object.defineProperty((new K12().get()) as object, "t", { value: 1 }), "t" in ((new K12().get()) as object)
3(): void { say("record/private-field/frozen", (Object.freeze((new K13().get())), Object.isFrozen((new K13().get()))
4(): void { say("record/private-field/prototype-set", (Object.setPrototypeOf((new K14().get()) as object, null), Object.getPrototypeOf((new K14().get())) === null
5(): void { say("record/private-field/deleted", (delete (((new K15().get())) as any).length, Object.hasOwn((new K15().get()) as object, "length")`,
        (n, a) => `function c1${a})); }

interface R${n + 11} { a${n + 11}: number; m${n + 11}: () => number }
function make${n + 11}(): R${n + 11} { return { a${n + 11}: 1, m${n + 11}: () => 1 }; }
class K${n + 11} { #f: unknown; constructor() { this.#f = make${n + 11}().m${n + 11}; } get(): unknown { return this.#f; } }`,
      ],
      `function same16(a: unknown, b: unknown): boolean { return a === b; }
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
function seen18(f: unknown): boolean { const same = f === last18; last18 = f; return same; }`,
      [
        `18(): void { say("record/private-field/kept-then-compared", (seen18((new K18().get())), seen18((new K18().get())))
19(): void { say("record/static-field/strict-eq", ((K19.f = make19().m19, K19.f)) === ((K19.f = make19().m19, K19.f))
20(): void { say("record/static-field/strict-ne", ((K20.f = make20().m20, K20.f)) !== ((K20.f = make20().m20, K20.f))
21(): void { say("record/static-field/loose-eq", ((K21.f = make21().m21, K21.f)) == ((K21.f = make21().m21, K21.f))
22(): void { say("record/static-field/object-is", Object.is(((K22.f = make22().m22, K22.f)), ((K22.f = make22().m22, K22.f)))
23(): void { say("record/static-field/set", new Set([((K23.f = make23().m23, K23.f)), ((K23.f = make23().m23, K23.f))]).size
24(): void { say("record/static-field/map-key", new Map([[((K24.f = make24().m24, K24.f)), 1], [((K24.f = make24().m24, K24.f)), 2]]).size
25(): void { say("record/static-field/includes", [((K25.f = make25().m25, K25.f))].includes(((K25.f = make25().m25, K25.f)))
26(): void { say("record/static-field/index-of", [((K26.f = make26().m26, K26.f))].indexOf(((K26.f = make26().m26, K26.f)))`,
        (n, a) => `function c${a}); }

interface R${n + 19} { a${n + 19}: number; m${n + 19}: () => number }
function make${n + 19}(): R${n + 19} { return { a${n + 19}: 1, m${n + 19}: () => 1 }; }
class K${n + 19} { static f: unknown; }`,
      ],
      `const ws27 = new WeakSet<object>();
function c27(): void { say("record/static-field/weak-set", (ws27.add(((K27.f = make27().m27, K27.f)) as object), ws27.has(((K27.f = make27().m27, K27.f)) as object))); }

interface R28 { a28: number; m28: () => number }
function make28(): R28 { return { a28: 1, m28: () => 1 }; }
class K28 { static f: unknown; }
const wm28 = new WeakMap<object, number>();`,
      [
        `28(): void { say("record/static-field/weak-map", (wm28.set(((K28.f = make28().m28, K28.f)) as object, 1), wm28.has(((K28.f = make28().m28, K28.f)) as object)
29(): void { say("record/static-field/written", (((((K29.f = make29().m29, K29.f))) as any).tag = 1, ((((K29.f = make29().m29, K29.f))) as any).tag
30(): void { say("record/static-field/defined", (Object.defineProperty(((K30.f = make30().m30, K30.f)) as object, "t", { value: 1 }), "t" in (((K30.f = make30().m30, K30.f)) as object)
31(): void { say("record/static-field/frozen", (Object.freeze(((K31.f = make31().m31, K31.f))), Object.isFrozen(((K31.f = make31().m31, K31.f)))
32(): void { say("record/static-field/prototype-set", (Object.setPrototypeOf(((K32.f = make32().m32, K32.f)) as object, null), Object.getPrototypeOf(((K32.f = make32().m32, K32.f))) === null
33(): void { say("record/static-field/deleted", (delete ((((K33.f = make33().m33, K33.f))) as any).length, Object.hasOwn(((K33.f = make33().m33, K33.f)) as object, "length")`,
        (n, a) => `function c${a})); }

interface R${n + 29} { a${n + 29}: number; m${n + 29}: () => number }
function make${n + 29}(): R${n + 29} { return { a${n + 29}: 1, m${n + 29}: () => 1 }; }
class K${n + 29} { static f: unknown; }`,
      ],
      `function same34(a: unknown, b: unknown): boolean { return a === b; }
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
function seen36(f: unknown): boolean { const same = f === last36; last36 = f; return same; }`,
      [
        `36(): void { say("record/static-field/kept-then-compared", (seen36(((K36.f = make36().m36, K36.f))), seen36(((K36.f = make36().m36, K36.f))))
37(): void { say("record/instance-field/strict-eq", (new K37().f) === (new K37().f)
38(): void { say("record/instance-field/strict-ne", (new K38().f) !== (new K38().f)
39(): void { say("record/instance-field/loose-eq", (new K39().f) == (new K39().f)
40(): void { say("record/instance-field/object-is", Object.is((new K40().f), (new K40().f))
41(): void { say("record/instance-field/set", new Set([(new K41().f), (new K41().f)]).size
42(): void { say("record/instance-field/map-key", new Map([[(new K42().f), 1], [(new K42().f), 2]]).size
43(): void { say("record/instance-field/includes", [(new K43().f)].includes((new K43().f))
44(): void { say("record/instance-field/index-of", [(new K44().f)].indexOf((new K44().f))`,
        (n, a) => `function c${a}); }

interface R${n + 37} { a${n + 37}: number; m${n + 37}: () => number }
function make${n + 37}(): R${n + 37} { return { a${n + 37}: 1, m${n + 37}: () => 1 }; }
class K${n + 37} { f: unknown = make${n + 37}().m${n + 37}; }`,
      ],
      `const ws45 = new WeakSet<object>();
function c45(): void { say("record/instance-field/weak-set", (ws45.add((new K45().f) as object), ws45.has((new K45().f) as object))); }

interface R46 { a46: number; m46: () => number }
function make46(): R46 { return { a46: 1, m46: () => 1 }; }
class K46 { f: unknown = make46().m46; }
const wm46 = new WeakMap<object, number>();`,
      [
        `46(): void { say("record/instance-field/weak-map", (wm46.set((new K46().f) as object, 1), wm46.has((new K46().f) as object)
47(): void { say("record/instance-field/written", ((((new K47().f)) as any).tag = 1, (((new K47().f)) as any).tag
48(): void { say("record/instance-field/defined", (Object.defineProperty((new K48().f) as object, "t", { value: 1 }), "t" in ((new K48().f) as object)
49(): void { say("record/instance-field/frozen", (Object.freeze((new K49().f)), Object.isFrozen((new K49().f))
50(): void { say("record/instance-field/prototype-set", (Object.setPrototypeOf((new K50().f) as object, null), Object.getPrototypeOf((new K50().f)) === null
51(): void { say("record/instance-field/deleted", (delete (((new K51().f)) as any).length, Object.hasOwn((new K51().f) as object, "length")`,
        (n, a) => `function c${a})); }

interface R${n + 47} { a${n + 47}: number; m${n + 47}: () => number }
function make${n + 47}(): R${n + 47} { return { a${n + 47}: 1, m${n + 47}: () => 1 }; }
class K${n + 47} { f: unknown = make${n + 47}().m${n + 47}; }`,
      ],
      `function same52(a: unknown, b: unknown): boolean { return a === b; }
function c52(): void { say("record/instance-field/in-a-callee", same52((new K52().f), (new K52().f))); }

interface R53 { a53: number; m53: () => number }
function make53(): R53 { return { a53: 1, m53: () => 1 }; }
class K53 { f: unknown = make53().m53; }
function hit53(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c53(): void { say("record/instance-field/switch", hit53((new K53().f), (new K53().f))); }

interface R54 { a54: number; m54: () => number }
function make54(): R54 { return { a54: 1, m54: () => 1 }; }
class K54 { f: unknown = make54().m54; }
let last54: unknown;`,
      [
        `seen54(f: unknown): boolean { const same = f === last54; last54 = f; return same	4(): void { say("record/instance-field/kept-then-compared", (seen54((new K54().f)), seen54((new K54().f)))
get55(): unknown { const k = new K55(); k.v = make55().m55; return k.s	5(): void { say("record/setter/strict-eq", (get55()) === (get55())
get56(): unknown { const k = new K56(); k.v = make56().m56; return k.s	6(): void { say("record/setter/strict-ne", (get56()) !== (get56())
get57(): unknown { const k = new K57(); k.v = make57().m57; return k.s	7(): void { say("record/setter/loose-eq", (get57()) == (get57())
get58(): unknown { const k = new K58(); k.v = make58().m58; return k.s	8(): void { say("record/setter/object-is", Object.is((get58()), (get58()))
get59(): unknown { const k = new K59(); k.v = make59().m59; return k.s	9(): void { say("record/setter/set", new Set([(get59()), (get59())]).size`,
        (n, a, b) => `function ${a}; }
function c5${b}); }

interface R${n + 55} { a${n + 55}: number; m${n + 55}: () => number }
function make${n + 55}(): R${n + 55} { return { a${n + 55}: 1, m${n + 55}: () => 1 }; }
class K${n + 55} { s: unknown; set v(x: unknown) { this.s = x; } }`,
      ],
      `function get60(): unknown { const k = new K60(); k.v = make60().m60; return k.s; }
function c60(): void { say("record/setter/map-key", new Map([[(get60()), 1], [(get60()), 2]]).size); }

c1(); c2(); c3(); c4(); c5(); c6(); c7(); c8(); c9(); c10(); c11(); c12(); c13(); c14(); c15(); c16(); c17(); c18(); c19(); c20(); c21(); c22(); c23(); c24(); c25(); c26(); c27(); c28(); c29(); c30(); c31(); c32(); c33(); c34(); c35(); c36(); c37(); c38(); c39(); c40(); c41(); c42(); c43(); c44(); c45(); c46(); c47(); c48(); c49(); c50(); c51(); c52(); c53(); c54(); c55(); c56(); c57(); c58(); c59(); c60();
console.log(out.join("\\n"));
`,
    ),
    "identity2-01.ts": text(
      `// Generated program: object and closure identity stays observable when allocations are removed (second series, part 1).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R61 { a61: number; m61: () => number }
function make61(): R61 { return { a61: 1, m61: () => 1 }; }
class K61 { s: unknown; set v(x: unknown) { this.s = x; } }
function get61(): unknown { const k = new K61(); k.v = make61().m61; return k.s; }
function c61(): void { say("record/setter/includes", [(get61())].includes((get61()))); }

interface R62 { a62: number; m62: () => number }
function make62(): R62 { return { a62: 1, m62: () => 1 }; }
class K62 { s: unknown; set v(x: unknown) { this.s = x; } }
function get62(): unknown { const k = new K62(); k.v = make62().m62; return k.s; }
function c62(): void { say("record/setter/index-of", [(get62())].indexOf((get62()))); }

interface R63 { a63: number; m63: () => number }
function make63(): R63 { return { a63: 1, m63: () => 1 }; }
class K63 { s: unknown; set v(x: unknown) { this.s = x; } }
function get63(): unknown { const k = new K63(); k.v = make63().m63; return k.s; }
const ws63 = new WeakSet<object>();
function c63(): void { say("record/setter/weak-set", (ws63.add((get63()) as object), ws63.has((get63()) as object))); }

interface R64 { a64: number; m64: () => number }
function make64(): R64 { return { a64: 1, m64: () => 1 }; }
class K64 { s: unknown; set v(x: unknown) { this.s = x; } }
function get64(): unknown { const k = new K64(); k.v = make64().m64; return k.s; }
const wm64 = new WeakMap<object, number>();`,
      [
        `4(): void { say("record/setter/weak-map", (wm64.set((get64()) as object, 1), wm64.has((get64()) as object)
5(): void { say("record/setter/written", ((((get65())) as any).tag = 1, (((get65())) as any).tag
6(): void { say("record/setter/defined", (Object.defineProperty((get66()) as object, "t", { value: 1 }), "t" in ((get66()) as object)
7(): void { say("record/setter/frozen", (Object.freeze((get67())), Object.isFrozen((get67()))
8(): void { say("record/setter/prototype-set", (Object.setPrototypeOf((get68()) as object, null), Object.getPrototypeOf((get68())) === null
9(): void { say("record/setter/deleted", (delete (((get69())) as any).length, Object.hasOwn((get69()) as object, "length")`,
        (n, a) => `function c6${a})); }

interface R${n + 65} { a${n + 65}: number; m${n + 65}: () => number }
function make${n + 65}(): R${n + 65} { return { a${n + 65}: 1, m${n + 65}: () => 1 }; }
class K${n + 65} { s: unknown; set v(x: unknown) { this.s = x; } }
function get${n + 65}(): unknown { const k = new K${n + 65}(); k.v = make${n + 65}().m${n + 65}; return k.s; }`,
      ],
      `function same70(a: unknown, b: unknown): boolean { return a === b; }
function c70(): void { say("record/setter/in-a-callee", same70((get70()), (get70()))); }

interface R71 { a71: number; m71: () => number }
function make71(): R71 { return { a71: 1, m71: () => 1 }; }
class K71 { s: unknown; set v(x: unknown) { this.s = x; } }
function get71(): unknown { const k = new K71(); k.v = make71().m71; return k.s; }
function hit71(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c71(): void { say("record/setter/switch", hit71((get71()), (get71()))); }

interface R72 { a72: number; m72: () => number }
function make72(): R72 { return { a72: 1, m72: () => 1 }; }
class K72 { s: unknown; set v(x: unknown) { this.s = x; } }
function get72(): unknown { const k = new K72(); k.v = make72().m72; return k.s; }
let last72: unknown;
function seen72(f: unknown): boolean { const same = f === last72; last72 = f; return same; }`,
      [
        `72(): void { say("record/setter/kept-then-compared", (seen72((get72())), seen72((get72())))
73(): void { say("record/super-method/strict-eq", (new D73().get()) === (new D73().get())
74(): void { say("record/super-method/strict-ne", (new D74().get()) !== (new D74().get())
75(): void { say("record/super-method/loose-eq", (new D75().get()) == (new D75().get())
76(): void { say("record/super-method/object-is", Object.is((new D76().get()), (new D76().get()))
77(): void { say("record/super-method/set", new Set([(new D77().get()), (new D77().get())]).size
78(): void { say("record/super-method/map-key", new Map([[(new D78().get()), 1], [(new D78().get()), 2]]).size
79(): void { say("record/super-method/includes", [(new D79().get())].includes((new D79().get()))
80(): void { say("record/super-method/index-of", [(new D80().get())].indexOf((new D80().get()))`,
        (n, a) => `function c${a}); }

interface R${n + 73} { a${n + 73}: number; m${n + 73}: () => number }
function make${n + 73}(): R${n + 73} { return { a${n + 73}: 1, m${n + 73}: () => 1 }; }
class B${n + 73} { get(): unknown { return make${n + 73}().m${n + 73}; } }
class D${n + 73} extends B${n + 73} { get(): unknown { return super.get(); } }`,
      ],
      `const ws81 = new WeakSet<object>();
function c81(): void { say("record/super-method/weak-set", (ws81.add((new D81().get()) as object), ws81.has((new D81().get()) as object))); }

interface R82 { a82: number; m82: () => number }
function make82(): R82 { return { a82: 1, m82: () => 1 }; }
class B82 { get(): unknown { return make82().m82; } }
class D82 extends B82 { get(): unknown { return super.get(); } }
const wm82 = new WeakMap<object, number>();`,
      [
        `2(): void { say("record/super-method/weak-map", (wm82.set((new D82().get()) as object, 1), wm82.has((new D82().get()) as object)
3(): void { say("record/super-method/written", ((((new D83().get())) as any).tag = 1, (((new D83().get())) as any).tag
4(): void { say("record/super-method/defined", (Object.defineProperty((new D84().get()) as object, "t", { value: 1 }), "t" in ((new D84().get()) as object)
5(): void { say("record/super-method/frozen", (Object.freeze((new D85().get())), Object.isFrozen((new D85().get()))
6(): void { say("record/super-method/prototype-set", (Object.setPrototypeOf((new D86().get()) as object, null), Object.getPrototypeOf((new D86().get())) === null
7(): void { say("record/super-method/deleted", (delete (((new D87().get())) as any).length, Object.hasOwn((new D87().get()) as object, "length")`,
        (n, a) => `function c8${a})); }

interface R${n + 83} { a${n + 83}: number; m${n + 83}: () => number }
function make${n + 83}(): R${n + 83} { return { a${n + 83}: 1, m${n + 83}: () => 1 }; }
class B${n + 83} { get(): unknown { return make${n + 83}().m${n + 83}; } }
class D${n + 83} extends B${n + 83} { get(): unknown { return super.get(); } }`,
      ],
      `function same88(a: unknown, b: unknown): boolean { return a === b; }
function c88(): void { say("record/super-method/in-a-callee", same88((new D88().get()), (new D88().get()))); }

interface R89 { a89: number; m89: () => number }
function make89(): R89 { return { a89: 1, m89: () => 1 }; }
class B89 { get(): unknown { return make89().m89; } }
class D89 extends B89 { get(): unknown { return super.get(); } }
function hit89(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c89(): void { say("record/super-method/switch", hit89((new D89().get()), (new D89().get()))); }

interface R90 { a90: number; m90: () => number }
function make90(): R90 { return { a90: 1, m90: () => 1 }; }
class B90 { get(): unknown { return make90().m90; } }
class D90 extends B90 { get(): unknown { return super.get(); } }
let last90: unknown;
function seen90(f: unknown): boolean { const same = f === last90; last90 = f; return same; }`,
      [
        `0(): void { say("record/super-method/kept-then-compared", (seen90((new D90().get())), seen90((new D90().get())))
1(): void { say("record/constructor-parameter/strict-eq", (new K91(make91().m91).f) === (new K91(make91().m91).f)
2(): void { say("record/constructor-parameter/strict-ne", (new K92(make92().m92).f) !== (new K92(make92().m92).f)
3(): void { say("record/constructor-parameter/loose-eq", (new K93(make93().m93).f) == (new K93(make93().m93).f)
4(): void { say("record/constructor-parameter/object-is", Object.is((new K94(make94().m94).f), (new K94(make94().m94).f))
5(): void { say("record/constructor-parameter/set", new Set([(new K95(make95().m95).f), (new K95(make95().m95).f)]).size
6(): void { say("record/constructor-parameter/map-key", new Map([[(new K96(make96().m96).f), 1], [(new K96(make96().m96).f), 2]]).size
7(): void { say("record/constructor-parameter/includes", [(new K97(make97().m97).f)].includes((new K97(make97().m97).f))
8(): void { say("record/constructor-parameter/index-of", [(new K98(make98().m98).f)].indexOf((new K98(make98().m98).f))`,
        (n, a) => `function c9${a}); }

interface R${n + 91} { a${n + 91}: number; m${n + 91}: () => number }
function make${n + 91}(): R${n + 91} { return { a${n + 91}: 1, m${n + 91}: () => 1 }; }
class K${n + 91} { constructor(public f: unknown) {} }`,
      ],
      `const ws99 = new WeakSet<object>();
function c99(): void { say("record/constructor-parameter/weak-set", (ws99.add((new K99(make99().m99).f) as object), ws99.has((new K99(make99().m99).f) as object))); }

interface R100 { a100: number; m100: () => number }
function make100(): R100 { return { a100: 1, m100: () => 1 }; }
class K100 { constructor(public f: unknown) {} }
const wm100 = new WeakMap<object, number>();`,
      [
        `0(): void { say("record/constructor-parameter/weak-map", (wm100.set((new K100(make100().m100).f) as object, 1), wm100.has((new K100(make100().m100).f) as object)
1(): void { say("record/constructor-parameter/written", ((((new K101(make101().m101).f)) as any).tag = 1, (((new K101(make101().m101).f)) as any).tag
2(): void { say("record/constructor-parameter/defined", (Object.defineProperty((new K102(make102().m102).f) as object, "t", { value: 1 }), "t" in ((new K102(make102().m102).f) as object)
3(): void { say("record/constructor-parameter/frozen", (Object.freeze((new K103(make103().m103).f)), Object.isFrozen((new K103(make103().m103).f))
4(): void { say("record/constructor-parameter/prototype-set", (Object.setPrototypeOf((new K104(make104().m104).f) as object, null), Object.getPrototypeOf((new K104(make104().m104).f)) === null
5(): void { say("record/constructor-parameter/deleted", (delete (((new K105(make105().m105).f)) as any).length, Object.hasOwn((new K105(make105().m105).f) as object, "length")`,
        (n, a) => `function c10${a})); }

interface R${n + 101} { a${n + 101}: number; m${n + 101}: () => number }
function make${n + 101}(): R${n + 101} { return { a${n + 101}: 1, m${n + 101}: () => 1 }; }
class K${n + 101} { constructor(public f: unknown) {} }`,
      ],
      `function same106(a: unknown, b: unknown): boolean { return a === b; }
function c106(): void { say("record/constructor-parameter/in-a-callee", same106((new K106(make106().m106).f), (new K106(make106().m106).f))); }

interface R107 { a107: number; m107: () => number }
function make107(): R107 { return { a107: 1, m107: () => 1 }; }
class K107 { constructor(public f: unknown) {} }
function hit107(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c107(): void { say("record/constructor-parameter/switch", hit107((new K107(make107().m107).f), (new K107(make107().m107).f))); }

interface R108 { a108: number; m108: () => number }
function make108(): R108 { return { a108: 1, m108: () => 1 }; }
class K108 { constructor(public f: unknown) {} }
let last108: unknown;`,
      [
        `seen108(f: unknown): boolean { const same = f === last108; last108 = f; return same	08(): void { say("record/constructor-parameter/kept-then-compared", (seen108((new K108(make108().m108).f)), seen108((new K108(make108().m108).f)))
tag109(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]	09(): void { say("record/tagged-template/strict-eq", (tag109\`\${make109().m109}\`) === (tag109\`\${make109().m109}\`)
tag110(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]	10(): void { say("record/tagged-template/strict-ne", (tag110\`\${make110().m110}\`) !== (tag110\`\${make110().m110}\`)
tag111(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]	11(): void { say("record/tagged-template/loose-eq", (tag111\`\${make111().m111}\`) == (tag111\`\${make111().m111}\`)
tag112(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]	12(): void { say("record/tagged-template/object-is", Object.is((tag112\`\${make112().m112}\`), (tag112\`\${make112().m112}\`))
tag113(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]	13(): void { say("record/tagged-template/set", new Set([(tag113\`\${make113().m113}\`), (tag113\`\${make113().m113}\`)]).size
tag114(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]	14(): void { say("record/tagged-template/map-key", new Map([[(tag114\`\${make114().m114}\`), 1], [(tag114\`\${make114().m114}\`), 2]]).size
tag115(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]	15(): void { say("record/tagged-template/includes", [(tag115\`\${make115().m115}\`)].includes((tag115\`\${make115().m115}\`))
tag116(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]	16(): void { say("record/tagged-template/index-of", [(tag116\`\${make116().m116}\`)].indexOf((tag116\`\${make116().m116}\`))`,
        (n, a, b) => `function ${a}; }
function c1${b}); }

interface R${n + 109} { a${n + 109}: number; m${n + 109}: () => number }
function make${n + 109}(): R${n + 109} { return { a${n + 109}: 1, m${n + 109}: () => 1 }; }`,
      ],
      `function tag117(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
const ws117 = new WeakSet<object>();
function c117(): void { say("record/tagged-template/weak-set", (ws117.add((tag117\`\${make117().m117}\`) as object), ws117.has((tag117\`\${make117().m117}\`) as object))); }

interface R118 { a118: number; m118: () => number }
function make118(): R118 { return { a118: 1, m118: () => 1 }; }
function tag118(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
const wm118 = new WeakMap<object, number>();
function c118(): void { say("record/tagged-template/weak-map", (wm118.set((tag118\`\${make118().m118}\`) as object, 1), wm118.has((tag118\`\${make118().m118}\`) as object))); }

interface R119 { a119: number; m119: () => number }
function make119(): R119 { return { a119: 1, m119: () => 1 }; }
function tag119(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c119(): void { say("record/tagged-template/written", ((((tag119\`\${make119().m119}\`)) as any).tag = 1, (((tag119\`\${make119().m119}\`)) as any).tag)); }

interface R120 { a120: number; m120: () => number }
function make120(): R120 { return { a120: 1, m120: () => 1 }; }
function tag120(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c120(): void { say("record/tagged-template/defined", (Object.defineProperty((tag120\`\${make120().m120}\`) as object, "t", { value: 1 }), "t" in ((tag120\`\${make120().m120}\`) as object))); }

c61(); c62(); c63(); c64(); c65(); c66(); c67(); c68(); c69(); c70(); c71(); c72(); c73(); c74(); c75(); c76(); c77(); c78(); c79(); c80(); c81(); c82(); c83(); c84(); c85(); c86(); c87(); c88(); c89(); c90(); c91(); c92(); c93(); c94(); c95(); c96(); c97(); c98(); c99(); c100(); c101(); c102(); c103(); c104(); c105(); c106(); c107(); c108(); c109(); c110(); c111(); c112(); c113(); c114(); c115(); c116(); c117(); c118(); c119(); c120();
console.log(out.join("\\n"));
`,
    ),
    "identity2-02.ts": text(
      `// Generated program: object and closure identity stays observable when allocations are removed (second series, part 2).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R121 { a121: number; m121: () => number }
function make121(): R121 { return { a121: 1, m121: () => 1 }; }
function tag121(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c121(): void { say("record/tagged-template/frozen", (Object.freeze((tag121\`\${make121().m121}\`)), Object.isFrozen((tag121\`\${make121().m121}\`)))); }

interface R122 { a122: number; m122: () => number }
function make122(): R122 { return { a122: 1, m122: () => 1 }; }
function tag122(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c122(): void { say("record/tagged-template/prototype-set", (Object.setPrototypeOf((tag122\`\${make122().m122}\`) as object, null), Object.getPrototypeOf((tag122\`\${make122().m122}\`)) === null)); }

interface R123 { a123: number; m123: () => number }
function make123(): R123 { return { a123: 1, m123: () => 1 }; }
function tag123(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c123(): void { say("record/tagged-template/deleted", (delete (((tag123\`\${make123().m123}\`)) as any).length, Object.hasOwn((tag123\`\${make123().m123}\`) as object, "length"))); }

interface R124 { a124: number; m124: () => number }
function make124(): R124 { return { a124: 1, m124: () => 1 }; }
function tag124(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function same124(a: unknown, b: unknown): boolean { return a === b; }
function c124(): void { say("record/tagged-template/in-a-callee", same124((tag124\`\${make124().m124}\`), (tag124\`\${make124().m124}\`))); }

interface R125 { a125: number; m125: () => number }
function make125(): R125 { return { a125: 1, m125: () => 1 }; }
function tag125(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function hit125(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c125(): void { say("record/tagged-template/switch", hit125((tag125\`\${make125().m125}\`), (tag125\`\${make125().m125}\`))); }

interface R126 { a126: number; m126: () => number }
function make126(): R126 { return { a126: 1, m126: () => 1 }; }
function tag126(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
let last126: unknown;`,
      [
        `seen126(f: unknown): boolean { const same = f === last126; last126 = f; return same	26(): void { say("record/tagged-template/kept-then-compared", (seen126((tag126\`\${make126().m126}\`)), seen126((tag126\`\${make126().m126}\`)))
get127(x: unknown = make127().m127): unknown { return x	27(): void { say("record/default-parameter/strict-eq", (get127()) === (get127())
get128(x: unknown = make128().m128): unknown { return x	28(): void { say("record/default-parameter/strict-ne", (get128()) !== (get128())
get129(x: unknown = make129().m129): unknown { return x	29(): void { say("record/default-parameter/loose-eq", (get129()) == (get129())
get130(x: unknown = make130().m130): unknown { return x	30(): void { say("record/default-parameter/object-is", Object.is((get130()), (get130()))
get131(x: unknown = make131().m131): unknown { return x	31(): void { say("record/default-parameter/set", new Set([(get131()), (get131())]).size
get132(x: unknown = make132().m132): unknown { return x	32(): void { say("record/default-parameter/map-key", new Map([[(get132()), 1], [(get132()), 2]]).size
get133(x: unknown = make133().m133): unknown { return x	33(): void { say("record/default-parameter/includes", [(get133())].includes((get133()))
get134(x: unknown = make134().m134): unknown { return x	34(): void { say("record/default-parameter/index-of", [(get134())].indexOf((get134()))`,
        (n, a, b) => `function ${a}; }
function c1${b}); }

interface R${n + 127} { a${n + 127}: number; m${n + 127}: () => number }
function make${n + 127}(): R${n + 127} { return { a${n + 127}: 1, m${n + 127}: () => 1 }; }`,
      ],
      `function get135(x: unknown = make135().m135): unknown { return x; }
const ws135 = new WeakSet<object>();
function c135(): void { say("record/default-parameter/weak-set", (ws135.add((get135()) as object), ws135.has((get135()) as object))); }

interface R136 { a136: number; m136: () => number }
function make136(): R136 { return { a136: 1, m136: () => 1 }; }
function get136(x: unknown = make136().m136): unknown { return x; }
const wm136 = new WeakMap<object, number>();`,
      [
        `36(): void { say("record/default-parameter/weak-map", (wm136.set((get136()) as object, 1), wm136.has((get136()) as object)
37(): void { say("record/default-parameter/written", ((((get137())) as any).tag = 1, (((get137())) as any).tag
38(): void { say("record/default-parameter/defined", (Object.defineProperty((get138()) as object, "t", { value: 1 }), "t" in ((get138()) as object)
39(): void { say("record/default-parameter/frozen", (Object.freeze((get139())), Object.isFrozen((get139()))
40(): void { say("record/default-parameter/prototype-set", (Object.setPrototypeOf((get140()) as object, null), Object.getPrototypeOf((get140())) === null
41(): void { say("record/default-parameter/deleted", (delete (((get141())) as any).length, Object.hasOwn((get141()) as object, "length")`,
        (n, a) => `function c1${a})); }

interface R${n + 137} { a${n + 137}: number; m${n + 137}: () => number }
function make${n + 137}(): R${n + 137} { return { a${n + 137}: 1, m${n + 137}: () => 1 }; }
function get${n + 137}(x: unknown = make${n + 137}().m${n + 137}): unknown { return x; }`,
      ],
      `function same142(a: unknown, b: unknown): boolean { return a === b; }
function c142(): void { say("record/default-parameter/in-a-callee", same142((get142()), (get142()))); }

interface R143 { a143: number; m143: () => number }
function make143(): R143 { return { a143: 1, m143: () => 1 }; }
function get143(x: unknown = make143().m143): unknown { return x; }
function hit143(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c143(): void { say("record/default-parameter/switch", hit143((get143()), (get143()))); }

interface R144 { a144: number; m144: () => number }
function make144(): R144 { return { a144: 1, m144: () => 1 }; }
function get144(x: unknown = make144().m144): unknown { return x; }
let last144: unknown;`,
      [
        `seen144(f: unknown): boolean { const same = f === last144; last144 = f; return same	44(): void { say("record/default-parameter/kept-then-compared", (seen144((get144())), seen144((get144())))
get145({ f = make145().m145 as unknown }: { f?: unknown } = {}): unknown { return f	45(): void { say("record/pattern-default/strict-eq", (get145()) === (get145())
get146({ f = make146().m146 as unknown }: { f?: unknown } = {}): unknown { return f	46(): void { say("record/pattern-default/strict-ne", (get146()) !== (get146())
get147({ f = make147().m147 as unknown }: { f?: unknown } = {}): unknown { return f	47(): void { say("record/pattern-default/loose-eq", (get147()) == (get147())
get148({ f = make148().m148 as unknown }: { f?: unknown } = {}): unknown { return f	48(): void { say("record/pattern-default/object-is", Object.is((get148()), (get148()))
get149({ f = make149().m149 as unknown }: { f?: unknown } = {}): unknown { return f	49(): void { say("record/pattern-default/set", new Set([(get149()), (get149())]).size
get150({ f = make150().m150 as unknown }: { f?: unknown } = {}): unknown { return f	50(): void { say("record/pattern-default/map-key", new Map([[(get150()), 1], [(get150()), 2]]).size
get151({ f = make151().m151 as unknown }: { f?: unknown } = {}): unknown { return f	51(): void { say("record/pattern-default/includes", [(get151())].includes((get151()))
get152({ f = make152().m152 as unknown }: { f?: unknown } = {}): unknown { return f	52(): void { say("record/pattern-default/index-of", [(get152())].indexOf((get152()))`,
        (n, a, b) => `function ${a}; }
function c1${b}); }

interface R${n + 145} { a${n + 145}: number; m${n + 145}: () => number }
function make${n + 145}(): R${n + 145} { return { a${n + 145}: 1, m${n + 145}: () => 1 }; }`,
      ],
      `function get153({ f = make153().m153 as unknown }: { f?: unknown } = {}): unknown { return f; }
const ws153 = new WeakSet<object>();
function c153(): void { say("record/pattern-default/weak-set", (ws153.add((get153()) as object), ws153.has((get153()) as object))); }

interface R154 { a154: number; m154: () => number }
function make154(): R154 { return { a154: 1, m154: () => 1 }; }
function get154({ f = make154().m154 as unknown }: { f?: unknown } = {}): unknown { return f; }
const wm154 = new WeakMap<object, number>();`,
      [
        `4(): void { say("record/pattern-default/weak-map", (wm154.set((get154()) as object, 1), wm154.has((get154()) as object)
5(): void { say("record/pattern-default/written", ((((get155())) as any).tag = 1, (((get155())) as any).tag
6(): void { say("record/pattern-default/defined", (Object.defineProperty((get156()) as object, "t", { value: 1 }), "t" in ((get156()) as object)
7(): void { say("record/pattern-default/frozen", (Object.freeze((get157())), Object.isFrozen((get157()))
8(): void { say("record/pattern-default/prototype-set", (Object.setPrototypeOf((get158()) as object, null), Object.getPrototypeOf((get158())) === null
9(): void { say("record/pattern-default/deleted", (delete (((get159())) as any).length, Object.hasOwn((get159()) as object, "length")`,
        (n, a) => `function c15${a})); }

interface R${n + 155} { a${n + 155}: number; m${n + 155}: () => number }
function make${n + 155}(): R${n + 155} { return { a${n + 155}: 1, m${n + 155}: () => 1 }; }
function get${n + 155}({ f = make${n + 155}().m${n + 155} as unknown }: { f?: unknown } = {}): unknown { return f; }`,
      ],
      `function same160(a: unknown, b: unknown): boolean { return a === b; }
function c160(): void { say("record/pattern-default/in-a-callee", same160((get160()), (get160()))); }

interface R161 { a161: number; m161: () => number }
function make161(): R161 { return { a161: 1, m161: () => 1 }; }
function get161({ f = make161().m161 as unknown }: { f?: unknown } = {}): unknown { return f; }
function hit161(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c161(): void { say("record/pattern-default/switch", hit161((get161()), (get161()))); }

interface R162 { a162: number; m162: () => number }
function make162(): R162 { return { a162: 1, m162: () => 1 }; }
function get162({ f = make162().m162 as unknown }: { f?: unknown } = {}): unknown { return f; }
let last162: unknown;`,
      [
        `seen162(f: unknown): boolean { const same = f === last162; last162 = f; return same	62(): void { say("record/pattern-default/kept-then-compared", (seen162((get162())), seen162((get162())))
get163(): unknown { const [f] = [make163().m163]; return f	63(): void { say("record/array-pattern/strict-eq", (get163()) === (get163())
get164(): unknown { const [f] = [make164().m164]; return f	64(): void { say("record/array-pattern/strict-ne", (get164()) !== (get164())
get165(): unknown { const [f] = [make165().m165]; return f	65(): void { say("record/array-pattern/loose-eq", (get165()) == (get165())
get166(): unknown { const [f] = [make166().m166]; return f	66(): void { say("record/array-pattern/object-is", Object.is((get166()), (get166()))
get167(): unknown { const [f] = [make167().m167]; return f	67(): void { say("record/array-pattern/set", new Set([(get167()), (get167())]).size
get168(): unknown { const [f] = [make168().m168]; return f	68(): void { say("record/array-pattern/map-key", new Map([[(get168()), 1], [(get168()), 2]]).size
get169(): unknown { const [f] = [make169().m169]; return f	69(): void { say("record/array-pattern/includes", [(get169())].includes((get169()))
get170(): unknown { const [f] = [make170().m170]; return f	70(): void { say("record/array-pattern/index-of", [(get170())].indexOf((get170()))`,
        (n, a, b) => `function ${a}; }
function c1${b}); }

interface R${n + 163} { a${n + 163}: number; m${n + 163}: () => number }
function make${n + 163}(): R${n + 163} { return { a${n + 163}: 1, m${n + 163}: () => 1 }; }`,
      ],
      `function get171(): unknown { const [f] = [make171().m171]; return f; }
const ws171 = new WeakSet<object>();
function c171(): void { say("record/array-pattern/weak-set", (ws171.add((get171()) as object), ws171.has((get171()) as object))); }

interface R172 { a172: number; m172: () => number }
function make172(): R172 { return { a172: 1, m172: () => 1 }; }
function get172(): unknown { const [f] = [make172().m172]; return f; }
const wm172 = new WeakMap<object, number>();`,
      [
        `2(): void { say("record/array-pattern/weak-map", (wm172.set((get172()) as object, 1), wm172.has((get172()) as object)
3(): void { say("record/array-pattern/written", ((((get173())) as any).tag = 1, (((get173())) as any).tag
4(): void { say("record/array-pattern/defined", (Object.defineProperty((get174()) as object, "t", { value: 1 }), "t" in ((get174()) as object)
5(): void { say("record/array-pattern/frozen", (Object.freeze((get175())), Object.isFrozen((get175()))
6(): void { say("record/array-pattern/prototype-set", (Object.setPrototypeOf((get176()) as object, null), Object.getPrototypeOf((get176())) === null
7(): void { say("record/array-pattern/deleted", (delete (((get177())) as any).length, Object.hasOwn((get177()) as object, "length")`,
        (n, a) => `function c17${a})); }

interface R${n + 173} { a${n + 173}: number; m${n + 173}: () => number }
function make${n + 173}(): R${n + 173} { return { a${n + 173}: 1, m${n + 173}: () => 1 }; }
function get${n + 173}(): unknown { const [f] = [make${n + 173}().m${n + 173}]; return f; }`,
      ],
      `function same178(a: unknown, b: unknown): boolean { return a === b; }
function c178(): void { say("record/array-pattern/in-a-callee", same178((get178()), (get178()))); }

interface R179 { a179: number; m179: () => number }
function make179(): R179 { return { a179: 1, m179: () => 1 }; }
function get179(): unknown { const [f] = [make179().m179]; return f; }
function hit179(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c179(): void { say("record/array-pattern/switch", hit179((get179()), (get179()))); }

interface R180 { a180: number; m180: () => number }
function make180(): R180 { return { a180: 1, m180: () => 1 }; }
function get180(): unknown { const [f] = [make180().m180]; return f; }
let last180: unknown;
function seen180(f: unknown): boolean { const same = f === last180; last180 = f; return same; }
function c180(): void { say("record/array-pattern/kept-then-compared", (seen180((get180())), seen180((get180())))); }

c121(); c122(); c123(); c124(); c125(); c126(); c127(); c128(); c129(); c130(); c131(); c132(); c133(); c134(); c135(); c136(); c137(); c138(); c139(); c140(); c141(); c142(); c143(); c144(); c145(); c146(); c147(); c148(); c149(); c150(); c151(); c152(); c153(); c154(); c155(); c156(); c157(); c158(); c159(); c160(); c161(); c162(); c163(); c164(); c165(); c166(); c167(); c168(); c169(); c170(); c171(); c172(); c173(); c174(); c175(); c176(); c177(); c178(); c179(); c180();
console.log(out.join("\\n"));
`,
    ),
    "identity2-08.ts": text(
      `// Generated program: object and closure identity stays observable when allocations are removed (second series, part 8).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R481 { a481: number; m481: () => number }
function make481(): R481 { return { a481: 1, m481: () => 1 }; }
function c481(): void { say("record/map-get/frozen", (Object.freeze((new Map([[1, make481().m481]]).get(1))), Object.isFrozen((new Map([[1, make481().m481]]).get(1))))); }

interface R482 { a482: number; m482: () => number }
function make482(): R482 { return { a482: 1, m482: () => 1 }; }
function c482(): void { say("record/map-get/prototype-set", (Object.setPrototypeOf((new Map([[1, make482().m482]]).get(1)) as object, null), Object.getPrototypeOf((new Map([[1, make482().m482]]).get(1))) === null)); }

interface R483 { a483: number; m483: () => number }
function make483(): R483 { return { a483: 1, m483: () => 1 }; }
function c483(): void { say("record/map-get/deleted", (delete (((new Map([[1, make483().m483]]).get(1))) as any).length, Object.hasOwn((new Map([[1, make483().m483]]).get(1)) as object, "length"))); }

interface R484 { a484: number; m484: () => number }
function make484(): R484 { return { a484: 1, m484: () => 1 }; }
function same484(a: unknown, b: unknown): boolean { return a === b; }
function c484(): void { say("record/map-get/in-a-callee", same484((new Map([[1, make484().m484]]).get(1)), (new Map([[1, make484().m484]]).get(1)))); }

interface R485 { a485: number; m485: () => number }
function make485(): R485 { return { a485: 1, m485: () => 1 }; }
function hit485(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c485(): void { say("record/map-get/switch", hit485((new Map([[1, make485().m485]]).get(1)), (new Map([[1, make485().m485]]).get(1)))); }

interface R486 { a486: number; m486: () => number }
function make486(): R486 { return { a486: 1, m486: () => 1 }; }
let last486: unknown;`,
      [
        `en486(f: unknown): boolean { const same = f === last486; last486 = f; return same	86(): void { say("record/map-get/kept-then-compared", (seen486((new Map([[1, make486().m486]]).get(1))), seen486((new Map([[1, make486().m486]]).get(1))))
lf487(this: unknown): unknown { return this	87(): void { say("record/bind-this/strict-eq", (self487.bind(make487().m487)()) === (self487.bind(make487().m487)())
lf488(this: unknown): unknown { return this	88(): void { say("record/bind-this/strict-ne", (self488.bind(make488().m488)()) !== (self488.bind(make488().m488)())
lf489(this: unknown): unknown { return this	89(): void { say("record/bind-this/loose-eq", (self489.bind(make489().m489)()) == (self489.bind(make489().m489)())
lf490(this: unknown): unknown { return this	90(): void { say("record/bind-this/object-is", Object.is((self490.bind(make490().m490)()), (self490.bind(make490().m490)()))
lf491(this: unknown): unknown { return this	91(): void { say("record/bind-this/set", new Set([(self491.bind(make491().m491)()), (self491.bind(make491().m491)())]).size
lf492(this: unknown): unknown { return this	92(): void { say("record/bind-this/map-key", new Map([[(self492.bind(make492().m492)()), 1], [(self492.bind(make492().m492)()), 2]]).size
lf493(this: unknown): unknown { return this	93(): void { say("record/bind-this/includes", [(self493.bind(make493().m493)())].includes((self493.bind(make493().m493)()))
lf494(this: unknown): unknown { return this	94(): void { say("record/bind-this/index-of", [(self494.bind(make494().m494)())].indexOf((self494.bind(make494().m494)()))`,
        (n, a, b) => `function se${a}; }
function c4${b}); }

interface R${n + 487} { a${n + 487}: number; m${n + 487}: () => number }
function make${n + 487}(): R${n + 487} { return { a${n + 487}: 1, m${n + 487}: () => 1 }; }`,
      ],
      `function self495(this: unknown): unknown { return this; }
const ws495 = new WeakSet<object>();
function c495(): void { say("record/bind-this/weak-set", (ws495.add((self495.bind(make495().m495)()) as object), ws495.has((self495.bind(make495().m495)()) as object))); }

interface R496 { a496: number; m496: () => number }
function make496(): R496 { return { a496: 1, m496: () => 1 }; }
function self496(this: unknown): unknown { return this; }
const wm496 = new WeakMap<object, number>();`,
      [
        `496(): void { say("record/bind-this/weak-map", (wm496.set((self496.bind(make496().m496)()) as object, 1), wm496.has((self496.bind(make496().m496)()) as object)
497(): void { say("record/bind-this/written", ((((self497.bind(make497().m497)())) as any).tag = 1, (((self497.bind(make497().m497)())) as any).tag
498(): void { say("record/bind-this/defined", (Object.defineProperty((self498.bind(make498().m498)()) as object, "t", { value: 1 }), "t" in ((self498.bind(make498().m498)()) as object)
499(): void { say("record/bind-this/frozen", (Object.freeze((self499.bind(make499().m499)())), Object.isFrozen((self499.bind(make499().m499)()))
500(): void { say("record/bind-this/prototype-set", (Object.setPrototypeOf((self500.bind(make500().m500)()) as object, null), Object.getPrototypeOf((self500.bind(make500().m500)())) === null
501(): void { say("record/bind-this/deleted", (delete (((self501.bind(make501().m501)())) as any).length, Object.hasOwn((self501.bind(make501().m501)()) as object, "length")`,
        (n, a) => `function c${a})); }

interface R${n + 497} { a${n + 497}: number; m${n + 497}: () => number }
function make${n + 497}(): R${n + 497} { return { a${n + 497}: 1, m${n + 497}: () => 1 }; }
function self${n + 497}(this: unknown): unknown { return this; }`,
      ],
      `function same502(a: unknown, b: unknown): boolean { return a === b; }
function c502(): void { say("record/bind-this/in-a-callee", same502((self502.bind(make502().m502)()), (self502.bind(make502().m502)()))); }

interface R503 { a503: number; m503: () => number }
function make503(): R503 { return { a503: 1, m503: () => 1 }; }
function self503(this: unknown): unknown { return this; }
function hit503(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c503(): void { say("record/bind-this/switch", hit503((self503.bind(make503().m503)()), (self503.bind(make503().m503)()))); }

interface R504 { a504: number; m504: () => number }
function make504(): R504 { return { a504: 1, m504: () => 1 }; }
function self504(this: unknown): unknown { return this; }
let last504: unknown;`,
      [
        `en504(f: unknown): boolean { const same = f === last504; last504 = f; return same	04(): void { say("record/bind-this/kept-then-compared", (seen504((self504.bind(make504().m504)())), seen504((self504.bind(make504().m504)())))
lf505(this: unknown): unknown { return this	05(): void { say("record/call-this/strict-eq", (self505.call(make505().m505)) === (self505.call(make505().m505))
lf506(this: unknown): unknown { return this	06(): void { say("record/call-this/strict-ne", (self506.call(make506().m506)) !== (self506.call(make506().m506))
lf507(this: unknown): unknown { return this	07(): void { say("record/call-this/loose-eq", (self507.call(make507().m507)) == (self507.call(make507().m507))
lf508(this: unknown): unknown { return this	08(): void { say("record/call-this/object-is", Object.is((self508.call(make508().m508)), (self508.call(make508().m508)))
lf509(this: unknown): unknown { return this	09(): void { say("record/call-this/set", new Set([(self509.call(make509().m509)), (self509.call(make509().m509))]).size
lf510(this: unknown): unknown { return this	10(): void { say("record/call-this/map-key", new Map([[(self510.call(make510().m510)), 1], [(self510.call(make510().m510)), 2]]).size
lf511(this: unknown): unknown { return this	11(): void { say("record/call-this/includes", [(self511.call(make511().m511))].includes((self511.call(make511().m511)))
lf512(this: unknown): unknown { return this	12(): void { say("record/call-this/index-of", [(self512.call(make512().m512))].indexOf((self512.call(make512().m512)))`,
        (n, a, b) => `function se${a}; }
function c5${b}); }

interface R${n + 505} { a${n + 505}: number; m${n + 505}: () => number }
function make${n + 505}(): R${n + 505} { return { a${n + 505}: 1, m${n + 505}: () => 1 }; }`,
      ],
      `function self513(this: unknown): unknown { return this; }
const ws513 = new WeakSet<object>();
function c513(): void { say("record/call-this/weak-set", (ws513.add((self513.call(make513().m513)) as object), ws513.has((self513.call(make513().m513)) as object))); }

interface R514 { a514: number; m514: () => number }
function make514(): R514 { return { a514: 1, m514: () => 1 }; }
function self514(this: unknown): unknown { return this; }
const wm514 = new WeakMap<object, number>();`,
      [
        `4(): void { say("record/call-this/weak-map", (wm514.set((self514.call(make514().m514)) as object, 1), wm514.has((self514.call(make514().m514)) as object)
5(): void { say("record/call-this/written", ((((self515.call(make515().m515))) as any).tag = 1, (((self515.call(make515().m515))) as any).tag
6(): void { say("record/call-this/defined", (Object.defineProperty((self516.call(make516().m516)) as object, "t", { value: 1 }), "t" in ((self516.call(make516().m516)) as object)
7(): void { say("record/call-this/frozen", (Object.freeze((self517.call(make517().m517))), Object.isFrozen((self517.call(make517().m517)))
8(): void { say("record/call-this/prototype-set", (Object.setPrototypeOf((self518.call(make518().m518)) as object, null), Object.getPrototypeOf((self518.call(make518().m518))) === null
9(): void { say("record/call-this/deleted", (delete (((self519.call(make519().m519))) as any).length, Object.hasOwn((self519.call(make519().m519)) as object, "length")`,
        (n, a) => `function c51${a})); }

interface R${n + 515} { a${n + 515}: number; m${n + 515}: () => number }
function make${n + 515}(): R${n + 515} { return { a${n + 515}: 1, m${n + 515}: () => 1 }; }
function self${n + 515}(this: unknown): unknown { return this; }`,
      ],
      `function same520(a: unknown, b: unknown): boolean { return a === b; }
function c520(): void { say("record/call-this/in-a-callee", same520((self520.call(make520().m520)), (self520.call(make520().m520)))); }

interface R521 { a521: number; m521: () => number }
function make521(): R521 { return { a521: 1, m521: () => 1 }; }
function self521(this: unknown): unknown { return this; }
function hit521(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c521(): void { say("record/call-this/switch", hit521((self521.call(make521().m521)), (self521.call(make521().m521)))); }

interface R522 { a522: number; m522: () => number }
function make522(): R522 { return { a522: 1, m522: () => 1 }; }
function self522(this: unknown): unknown { return this; }
let last522: unknown;`,
      [
        `seen522(f: unknown): boolean { const same = f === last522; last522 = f; return same	22(): void { say("record/call-this/kept-then-compared", (seen522((self522.call(make522().m522))), seen522((self522.call(make522().m522))))
first523(x: unknown): unknown { return x	23(): void { say("record/apply-arguments/strict-eq", (first523.apply(null, [make523().m523])) === (first523.apply(null, [make523().m523]))
first524(x: unknown): unknown { return x	24(): void { say("record/apply-arguments/strict-ne", (first524.apply(null, [make524().m524])) !== (first524.apply(null, [make524().m524]))
first525(x: unknown): unknown { return x	25(): void { say("record/apply-arguments/loose-eq", (first525.apply(null, [make525().m525])) == (first525.apply(null, [make525().m525]))
first526(x: unknown): unknown { return x	26(): void { say("record/apply-arguments/object-is", Object.is((first526.apply(null, [make526().m526])), (first526.apply(null, [make526().m526])))
first527(x: unknown): unknown { return x	27(): void { say("record/apply-arguments/set", new Set([(first527.apply(null, [make527().m527])), (first527.apply(null, [make527().m527]))]).size
first528(x: unknown): unknown { return x	28(): void { say("record/apply-arguments/map-key", new Map([[(first528.apply(null, [make528().m528])), 1], [(first528.apply(null, [make528().m528])), 2]]).size
first529(x: unknown): unknown { return x	29(): void { say("record/apply-arguments/includes", [(first529.apply(null, [make529().m529]))].includes((first529.apply(null, [make529().m529])))
first530(x: unknown): unknown { return x	30(): void { say("record/apply-arguments/index-of", [(first530.apply(null, [make530().m530]))].indexOf((first530.apply(null, [make530().m530])))`,
        (n, a, b) => `function ${a}; }
function c5${b}); }

interface R${n + 523} { a${n + 523}: number; m${n + 523}: () => number }
function make${n + 523}(): R${n + 523} { return { a${n + 523}: 1, m${n + 523}: () => 1 }; }`,
      ],
      `function first531(x: unknown): unknown { return x; }
const ws531 = new WeakSet<object>();
function c531(): void { say("record/apply-arguments/weak-set", (ws531.add((first531.apply(null, [make531().m531])) as object), ws531.has((first531.apply(null, [make531().m531])) as object))); }

interface R532 { a532: number; m532: () => number }
function make532(): R532 { return { a532: 1, m532: () => 1 }; }
function first532(x: unknown): unknown { return x; }
const wm532 = new WeakMap<object, number>();`,
      [
        `2(): void { say("record/apply-arguments/weak-map", (wm532.set((first532.apply(null, [make532().m532])) as object, 1), wm532.has((first532.apply(null, [make532().m532])) as object)
3(): void { say("record/apply-arguments/written", ((((first533.apply(null, [make533().m533]))) as any).tag = 1, (((first533.apply(null, [make533().m533]))) as any).tag
4(): void { say("record/apply-arguments/defined", (Object.defineProperty((first534.apply(null, [make534().m534])) as object, "t", { value: 1 }), "t" in ((first534.apply(null, [make534().m534])) as object)
5(): void { say("record/apply-arguments/frozen", (Object.freeze((first535.apply(null, [make535().m535]))), Object.isFrozen((first535.apply(null, [make535().m535])))
6(): void { say("record/apply-arguments/prototype-set", (Object.setPrototypeOf((first536.apply(null, [make536().m536])) as object, null), Object.getPrototypeOf((first536.apply(null, [make536().m536]))) === null
7(): void { say("record/apply-arguments/deleted", (delete (((first537.apply(null, [make537().m537]))) as any).length, Object.hasOwn((first537.apply(null, [make537().m537])) as object, "length")`,
        (n, a) => `function c53${a})); }

interface R${n + 533} { a${n + 533}: number; m${n + 533}: () => number }
function make${n + 533}(): R${n + 533} { return { a${n + 533}: 1, m${n + 533}: () => 1 }; }
function first${n + 533}(x: unknown): unknown { return x; }`,
      ],
      `function same538(a: unknown, b: unknown): boolean { return a === b; }
function c538(): void { say("record/apply-arguments/in-a-callee", same538((first538.apply(null, [make538().m538])), (first538.apply(null, [make538().m538])))); }

interface R539 { a539: number; m539: () => number }
function make539(): R539 { return { a539: 1, m539: () => 1 }; }
function first539(x: unknown): unknown { return x; }
function hit539(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c539(): void { say("record/apply-arguments/switch", hit539((first539.apply(null, [make539().m539])), (first539.apply(null, [make539().m539])))); }

interface R540 { a540: number; m540: () => number }
function make540(): R540 { return { a540: 1, m540: () => 1 }; }
function first540(x: unknown): unknown { return x; }
let last540: unknown;
function seen540(f: unknown): boolean { const same = f === last540; last540 = f; return same; }
function c540(): void { say("record/apply-arguments/kept-then-compared", (seen540((first540.apply(null, [make540().m540]))), seen540((first540.apply(null, [make540().m540]))))); }

c481(); c482(); c483(); c484(); c485(); c486(); c487(); c488(); c489(); c490(); c491(); c492(); c493(); c494(); c495(); c496(); c497(); c498(); c499(); c500(); c501(); c502(); c503(); c504(); c505(); c506(); c507(); c508(); c509(); c510(); c511(); c512(); c513(); c514(); c515(); c516(); c517(); c518(); c519(); c520(); c521(); c522(); c523(); c524(); c525(); c526(); c527(); c528(); c529(); c530(); c531(); c532(); c533(); c534(); c535(); c536(); c537(); c538(); c539(); c540();
console.log(out.join("\\n"));
`,
    ),
    "identity2-12.ts": text(
      `// Generated program: object and closure identity stays observable when allocations are removed (second series, part 12).
declare const console: any;
const out: string[] = [];`,
      [
        `say(name: string, value: unknown): void { out.push(name + "=" + String(value)
c721(): void { say("record/arguments-object/strict-eq", (get721(make721().m721)) === (get721(make721().m721))
c722(): void { say("record/arguments-object/strict-ne", (get722(make722().m722)) !== (get722(make722().m722))
c723(): void { say("record/arguments-object/loose-eq", (get723(make723().m723)) == (get723(make723().m723))
c724(): void { say("record/arguments-object/object-is", Object.is((get724(make724().m724)), (get724(make724().m724)))
c725(): void { say("record/arguments-object/set", new Set([(get725(make725().m725)), (get725(make725().m725))]).size
c726(): void { say("record/arguments-object/map-key", new Map([[(get726(make726().m726)), 1], [(get726(make726().m726)), 2]]).size
c727(): void { say("record/arguments-object/includes", [(get727(make727().m727))].includes((get727(make727().m727)))
c728(): void { say("record/arguments-object/index-of", [(get728(make728().m728))].indexOf((get728(make728().m728)))`,
        (n, a) => `function ${a}); }

interface R${n + 721} { a${n + 721}: number; m${n + 721}: () => number }
function make${n + 721}(): R${n + 721} { return { a${n + 721}: 1, m${n + 721}: () => 1 }; }
function get${n + 721}(_x: unknown): unknown { return arguments[0]; }`,
      ],
      `const ws729 = new WeakSet<object>();
function c729(): void { say("record/arguments-object/weak-set", (ws729.add((get729(make729().m729)) as object), ws729.has((get729(make729().m729)) as object))); }

interface R730 { a730: number; m730: () => number }
function make730(): R730 { return { a730: 1, m730: () => 1 }; }
function get730(_x: unknown): unknown { return arguments[0]; }
const wm730 = new WeakMap<object, number>();`,
      [
        `0(): void { say("record/arguments-object/weak-map", (wm730.set((get730(make730().m730)) as object, 1), wm730.has((get730(make730().m730)) as object)
1(): void { say("record/arguments-object/written", ((((get731(make731().m731))) as any).tag = 1, (((get731(make731().m731))) as any).tag
2(): void { say("record/arguments-object/defined", (Object.defineProperty((get732(make732().m732)) as object, "t", { value: 1 }), "t" in ((get732(make732().m732)) as object)
3(): void { say("record/arguments-object/frozen", (Object.freeze((get733(make733().m733))), Object.isFrozen((get733(make733().m733)))
4(): void { say("record/arguments-object/prototype-set", (Object.setPrototypeOf((get734(make734().m734)) as object, null), Object.getPrototypeOf((get734(make734().m734))) === null
5(): void { say("record/arguments-object/deleted", (delete (((get735(make735().m735))) as any).length, Object.hasOwn((get735(make735().m735)) as object, "length")`,
        (n, a) => `function c73${a})); }

interface R${n + 731} { a${n + 731}: number; m${n + 731}: () => number }
function make${n + 731}(): R${n + 731} { return { a${n + 731}: 1, m${n + 731}: () => 1 }; }
function get${n + 731}(_x: unknown): unknown { return arguments[0]; }`,
      ],
      `function same736(a: unknown, b: unknown): boolean { return a === b; }
function c736(): void { say("record/arguments-object/in-a-callee", same736((get736(make736().m736)), (get736(make736().m736)))); }

interface R737 { a737: number; m737: () => number }
function make737(): R737 { return { a737: 1, m737: () => 1 }; }
function get737(_x: unknown): unknown { return arguments[0]; }
function hit737(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c737(): void { say("record/arguments-object/switch", hit737((get737(make737().m737)), (get737(make737().m737)))); }

interface R738 { a738: number; m738: () => number }
function make738(): R738 { return { a738: 1, m738: () => 1 }; }
function get738(_x: unknown): unknown { return arguments[0]; }
let last738: unknown;`,
      [
        `seen738(f: unknown): boolean { const same = f === last738; last738 = f; return same	38(): void { say("record/arguments-object/kept-then-compared", (seen738((get738(make738().m738))), seen738((get738(make738().m738))))
get739(n: number): unknown { return n === 0 ? make739().m739 : get739(n - 1)	39(): void { say("record/recursion/strict-eq", (get739(2)) === (get739(2))
get740(n: number): unknown { return n === 0 ? make740().m740 : get740(n - 1)	40(): void { say("record/recursion/strict-ne", (get740(2)) !== (get740(2))
get741(n: number): unknown { return n === 0 ? make741().m741 : get741(n - 1)	41(): void { say("record/recursion/loose-eq", (get741(2)) == (get741(2))
get742(n: number): unknown { return n === 0 ? make742().m742 : get742(n - 1)	42(): void { say("record/recursion/object-is", Object.is((get742(2)), (get742(2)))
get743(n: number): unknown { return n === 0 ? make743().m743 : get743(n - 1)	43(): void { say("record/recursion/set", new Set([(get743(2)), (get743(2))]).size
get744(n: number): unknown { return n === 0 ? make744().m744 : get744(n - 1)	44(): void { say("record/recursion/map-key", new Map([[(get744(2)), 1], [(get744(2)), 2]]).size
get745(n: number): unknown { return n === 0 ? make745().m745 : get745(n - 1)	45(): void { say("record/recursion/includes", [(get745(2))].includes((get745(2)))
get746(n: number): unknown { return n === 0 ? make746().m746 : get746(n - 1)	46(): void { say("record/recursion/index-of", [(get746(2))].indexOf((get746(2)))`,
        (n, a, b) => `function ${a}; }
function c7${b}); }

interface R${n + 739} { a${n + 739}: number; m${n + 739}: () => number }
function make${n + 739}(): R${n + 739} { return { a${n + 739}: 1, m${n + 739}: () => 1 }; }`,
      ],
      `function get747(n: number): unknown { return n === 0 ? make747().m747 : get747(n - 1); }
const ws747 = new WeakSet<object>();
function c747(): void { say("record/recursion/weak-set", (ws747.add((get747(2)) as object), ws747.has((get747(2)) as object))); }

interface R748 { a748: number; m748: () => number }
function make748(): R748 { return { a748: 1, m748: () => 1 }; }
function get748(n: number): unknown { return n === 0 ? make748().m748 : get748(n - 1); }
const wm748 = new WeakMap<object, number>();`,
      [
        `48(): void { say("record/recursion/weak-map", (wm748.set((get748(2)) as object, 1), wm748.has((get748(2)) as object)
49(): void { say("record/recursion/written", ((((get749(2))) as any).tag = 1, (((get749(2))) as any).tag
50(): void { say("record/recursion/defined", (Object.defineProperty((get750(2)) as object, "t", { value: 1 }), "t" in ((get750(2)) as object)
51(): void { say("record/recursion/frozen", (Object.freeze((get751(2))), Object.isFrozen((get751(2)))
52(): void { say("record/recursion/prototype-set", (Object.setPrototypeOf((get752(2)) as object, null), Object.getPrototypeOf((get752(2))) === null
53(): void { say("record/recursion/deleted", (delete (((get753(2))) as any).length, Object.hasOwn((get753(2)) as object, "length")`,
        (n, a) => `function c7${a})); }

interface R${n + 749} { a${n + 749}: number; m${n + 749}: () => number }
function make${n + 749}(): R${n + 749} { return { a${n + 749}: 1, m${n + 749}: () => 1 }; }
function get${n + 749}(n: number): unknown { return n === 0 ? make${n + 749}().m${n + 749} : get${n + 749}(n - 1); }`,
      ],
      `function same754(a: unknown, b: unknown): boolean { return a === b; }
function c754(): void { say("record/recursion/in-a-callee", same754((get754(2)), (get754(2)))); }

interface R755 { a755: number; m755: () => number }
function make755(): R755 { return { a755: 1, m755: () => 1 }; }
function get755(n: number): unknown { return n === 0 ? make755().m755 : get755(n - 1); }
function hit755(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c755(): void { say("record/recursion/switch", hit755((get755(2)), (get755(2)))); }

interface R756 { a756: number; m756: () => number }
function make756(): R756 { return { a756: 1, m756: () => 1 }; }
function get756(n: number): unknown { return n === 0 ? make756().m756 : get756(n - 1); }
let last756: unknown;`,
      [
        `seen756(f: unknown): boolean { const same = f === last756; last756 = f; return same	56(): void { say("record/recursion/kept-then-compared", (seen756((get756(2))), seen756((get756(2))))
odd757(n: number): unknown { return even757(n - 1)	57(): void { say("record/mutual-recursion/strict-eq", (even757(2)) === (even757(2))
odd758(n: number): unknown { return even758(n - 1)	58(): void { say("record/mutual-recursion/strict-ne", (even758(2)) !== (even758(2))
odd759(n: number): unknown { return even759(n - 1)	59(): void { say("record/mutual-recursion/loose-eq", (even759(2)) == (even759(2))
odd760(n: number): unknown { return even760(n - 1)	60(): void { say("record/mutual-recursion/object-is", Object.is((even760(2)), (even760(2)))
odd761(n: number): unknown { return even761(n - 1)	61(): void { say("record/mutual-recursion/set", new Set([(even761(2)), (even761(2))]).size
odd762(n: number): unknown { return even762(n - 1)	62(): void { say("record/mutual-recursion/map-key", new Map([[(even762(2)), 1], [(even762(2)), 2]]).size
odd763(n: number): unknown { return even763(n - 1)	63(): void { say("record/mutual-recursion/includes", [(even763(2))].includes((even763(2)))
odd764(n: number): unknown { return even764(n - 1)	64(): void { say("record/mutual-recursion/index-of", [(even764(2))].indexOf((even764(2)))`,
        (n, a, b) => `function ${a}; }
function c7${b}); }

interface R${n + 757} { a${n + 757}: number; m${n + 757}: () => number }
function make${n + 757}(): R${n + 757} { return { a${n + 757}: 1, m${n + 757}: () => 1 }; }
function even${n + 757}(n: number): unknown { return n === 0 ? make${n + 757}().m${n + 757} : odd${n + 757}(n - 1); }`,
      ],
      `function odd765(n: number): unknown { return even765(n - 1); }
const ws765 = new WeakSet<object>();
function c765(): void { say("record/mutual-recursion/weak-set", (ws765.add((even765(2)) as object), ws765.has((even765(2)) as object))); }

interface R766 { a766: number; m766: () => number }
function make766(): R766 { return { a766: 1, m766: () => 1 }; }
function even766(n: number): unknown { return n === 0 ? make766().m766 : odd766(n - 1); }
function odd766(n: number): unknown { return even766(n - 1); }
const wm766 = new WeakMap<object, number>();`,
      [
        `66(): void { say("record/mutual-recursion/weak-map", (wm766.set((even766(2)) as object, 1), wm766.has((even766(2)) as object)
67(): void { say("record/mutual-recursion/written", ((((even767(2))) as any).tag = 1, (((even767(2))) as any).tag
68(): void { say("record/mutual-recursion/defined", (Object.defineProperty((even768(2)) as object, "t", { value: 1 }), "t" in ((even768(2)) as object)
69(): void { say("record/mutual-recursion/frozen", (Object.freeze((even769(2))), Object.isFrozen((even769(2)))
70(): void { say("record/mutual-recursion/prototype-set", (Object.setPrototypeOf((even770(2)) as object, null), Object.getPrototypeOf((even770(2))) === null
71(): void { say("record/mutual-recursion/deleted", (delete (((even771(2))) as any).length, Object.hasOwn((even771(2)) as object, "length")`,
        (n, a) => `function c7${a})); }

interface R${n + 767} { a${n + 767}: number; m${n + 767}: () => number }
function make${n + 767}(): R${n + 767} { return { a${n + 767}: 1, m${n + 767}: () => 1 }; }
function even${n + 767}(n: number): unknown { return n === 0 ? make${n + 767}().m${n + 767} : odd${n + 767}(n - 1); }
function odd${n + 767}(n: number): unknown { return even${n + 767}(n - 1); }`,
      ],
      `function same772(a: unknown, b: unknown): boolean { return a === b; }
function c772(): void { say("record/mutual-recursion/in-a-callee", same772((even772(2)), (even772(2)))); }

interface R773 { a773: number; m773: () => number }
function make773(): R773 { return { a773: 1, m773: () => 1 }; }
function even773(n: number): unknown { return n === 0 ? make773().m773 : odd773(n - 1); }
function odd773(n: number): unknown { return even773(n - 1); }
function hit773(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c773(): void { say("record/mutual-recursion/switch", hit773((even773(2)), (even773(2)))); }

interface R774 { a774: number; m774: () => number }
function make774(): R774 { return { a774: 1, m774: () => 1 }; }
function even774(n: number): unknown { return n === 0 ? make774().m774 : odd774(n - 1); }
function odd774(n: number): unknown { return even774(n - 1); }
let last774: unknown;`,
      [
        `seen774(f: unknown): boolean { const same = f === last774; last774 = f; return same	4(): void { say("record/mutual-recursion/kept-then-compared", (seen774((even774(2))), seen774((even774(2))))
again775(): R775 { return make775()	5(): void { say("record/maker-forwarded/strict-eq", (again775().m775) === (again775().m775)
again776(): R776 { return make776()	6(): void { say("record/maker-forwarded/strict-ne", (again776().m776) !== (again776().m776)
again777(): R777 { return make777()	7(): void { say("record/maker-forwarded/loose-eq", (again777().m777) == (again777().m777)
again778(): R778 { return make778()	8(): void { say("record/maker-forwarded/object-is", Object.is((again778().m778), (again778().m778))
again779(): R779 { return make779()	9(): void { say("record/maker-forwarded/set", new Set([(again779().m779), (again779().m779)]).size`,
        (n, a, b) => `function ${a}; }
function c77${b}); }

interface R${n + 775} { a${n + 775}: number; m${n + 775}: () => number }
function make${n + 775}(): R${n + 775} { return { a${n + 775}: 1, m${n + 775}: () => 1 }; }`,
      ],
      `function again780(): R780 { return make780(); }
function c780(): void { say("record/maker-forwarded/map-key", new Map([[(again780().m780), 1], [(again780().m780), 2]]).size); }

c721(); c722(); c723(); c724(); c725(); c726(); c727(); c728(); c729(); c730(); c731(); c732(); c733(); c734(); c735(); c736(); c737(); c738(); c739(); c740(); c741(); c742(); c743(); c744(); c745(); c746(); c747(); c748(); c749(); c750(); c751(); c752(); c753(); c754(); c755(); c756(); c757(); c758(); c759(); c760(); c761(); c762(); c763(); c764(); c765(); c766(); c767(); c768(); c769(); c770(); c771(); c772(); c773(); c774(); c775(); c776(); c777(); c778(); c779(); c780();
console.log(out.join("\\n"));
`,
    ),
    "identity2-13.ts": text(
      `// Generated program: object and closure identity stays observable when allocations are removed (second series, part 13).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R781 { a781: number; m781: () => number }
function make781(): R781 { return { a781: 1, m781: () => 1 }; }
function again781(): R781 { return make781(); }
function c781(): void { say("record/maker-forwarded/includes", [(again781().m781)].includes((again781().m781))); }

interface R782 { a782: number; m782: () => number }
function make782(): R782 { return { a782: 1, m782: () => 1 }; }
function again782(): R782 { return make782(); }
function c782(): void { say("record/maker-forwarded/index-of", [(again782().m782)].indexOf((again782().m782))); }

interface R783 { a783: number; m783: () => number }
function make783(): R783 { return { a783: 1, m783: () => 1 }; }
function again783(): R783 { return make783(); }
const ws783 = new WeakSet<object>();
function c783(): void { say("record/maker-forwarded/weak-set", (ws783.add((again783().m783) as object), ws783.has((again783().m783) as object))); }

interface R784 { a784: number; m784: () => number }
function make784(): R784 { return { a784: 1, m784: () => 1 }; }
function again784(): R784 { return make784(); }
const wm784 = new WeakMap<object, number>();`,
      [
        `4(): void { say("record/maker-forwarded/weak-map", (wm784.set((again784().m784) as object, 1), wm784.has((again784().m784) as object)
5(): void { say("record/maker-forwarded/written", ((((again785().m785)) as any).tag = 1, (((again785().m785)) as any).tag
6(): void { say("record/maker-forwarded/defined", (Object.defineProperty((again786().m786) as object, "t", { value: 1 }), "t" in ((again786().m786) as object)
7(): void { say("record/maker-forwarded/frozen", (Object.freeze((again787().m787)), Object.isFrozen((again787().m787))
8(): void { say("record/maker-forwarded/prototype-set", (Object.setPrototypeOf((again788().m788) as object, null), Object.getPrototypeOf((again788().m788)) === null
9(): void { say("record/maker-forwarded/deleted", (delete (((again789().m789)) as any).length, Object.hasOwn((again789().m789) as object, "length")`,
        (n, a) => `function c78${a})); }

interface R${n + 785} { a${n + 785}: number; m${n + 785}: () => number }
function make${n + 785}(): R${n + 785} { return { a${n + 785}: 1, m${n + 785}: () => 1 }; }
function again${n + 785}(): R${n + 785} { return make${n + 785}(); }`,
      ],
      `function same790(a: unknown, b: unknown): boolean { return a === b; }
function c790(): void { say("record/maker-forwarded/in-a-callee", same790((again790().m790), (again790().m790))); }

interface R791 { a791: number; m791: () => number }
function make791(): R791 { return { a791: 1, m791: () => 1 }; }
function again791(): R791 { return make791(); }
function hit791(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c791(): void { say("record/maker-forwarded/switch", hit791((again791().m791), (again791().m791))); }

interface R792 { a792: number; m792: () => number }
function make792(): R792 { return { a792: 1, m792: () => 1 }; }
function again792(): R792 { return make792(); }
let last792: unknown;`,
      [
        `seen792(f: unknown): boolean { const same = f === last792; last792 = f; return same	792(): void { say("record/maker-forwarded/kept-then-compared", (seen792((again792().m792)), seen792((again792().m792)))
get793(): unknown { return again793().m793	793(): void { say("record/maker-forwarded-and-returned/strict-eq", (get793()) === (get793())
get794(): unknown { return again794().m794	794(): void { say("record/maker-forwarded-and-returned/strict-ne", (get794()) !== (get794())
get795(): unknown { return again795().m795	795(): void { say("record/maker-forwarded-and-returned/loose-eq", (get795()) == (get795())
get796(): unknown { return again796().m796	796(): void { say("record/maker-forwarded-and-returned/object-is", Object.is((get796()), (get796()))
get797(): unknown { return again797().m797	797(): void { say("record/maker-forwarded-and-returned/set", new Set([(get797()), (get797())]).size
get798(): unknown { return again798().m798	798(): void { say("record/maker-forwarded-and-returned/map-key", new Map([[(get798()), 1], [(get798()), 2]]).size
get799(): unknown { return again799().m799	799(): void { say("record/maker-forwarded-and-returned/includes", [(get799())].includes((get799()))
get800(): unknown { return again800().m800	800(): void { say("record/maker-forwarded-and-returned/index-of", [(get800())].indexOf((get800()))`,
        (n, a, b) => `function ${a}; }
function c${b}); }

interface R${n + 793} { a${n + 793}: number; m${n + 793}: () => number }
function make${n + 793}(): R${n + 793} { return { a${n + 793}: 1, m${n + 793}: () => 1 }; }
function again${n + 793}(): R${n + 793} { return make${n + 793}(); }`,
      ],
      `function get801(): unknown { return again801().m801; }
const ws801 = new WeakSet<object>();
function c801(): void { say("record/maker-forwarded-and-returned/weak-set", (ws801.add((get801()) as object), ws801.has((get801()) as object))); }

interface R802 { a802: number; m802: () => number }
function make802(): R802 { return { a802: 1, m802: () => 1 }; }
function again802(): R802 { return make802(); }
function get802(): unknown { return again802().m802; }
const wm802 = new WeakMap<object, number>();`,
      [
        `2(): void { say("record/maker-forwarded-and-returned/weak-map", (wm802.set((get802()) as object, 1), wm802.has((get802()) as object)
3(): void { say("record/maker-forwarded-and-returned/written", ((((get803())) as any).tag = 1, (((get803())) as any).tag
4(): void { say("record/maker-forwarded-and-returned/defined", (Object.defineProperty((get804()) as object, "t", { value: 1 }), "t" in ((get804()) as object)
5(): void { say("record/maker-forwarded-and-returned/frozen", (Object.freeze((get805())), Object.isFrozen((get805()))
6(): void { say("record/maker-forwarded-and-returned/prototype-set", (Object.setPrototypeOf((get806()) as object, null), Object.getPrototypeOf((get806())) === null
7(): void { say("record/maker-forwarded-and-returned/deleted", (delete (((get807())) as any).length, Object.hasOwn((get807()) as object, "length")`,
        (n, a) => `function c80${a})); }

interface R${n + 803} { a${n + 803}: number; m${n + 803}: () => number }
function make${n + 803}(): R${n + 803} { return { a${n + 803}: 1, m${n + 803}: () => 1 }; }
function again${n + 803}(): R${n + 803} { return make${n + 803}(); }
function get${n + 803}(): unknown { return again${n + 803}().m${n + 803}; }`,
      ],
      `function same808(a: unknown, b: unknown): boolean { return a === b; }
function c808(): void { say("record/maker-forwarded-and-returned/in-a-callee", same808((get808()), (get808()))); }

interface R809 { a809: number; m809: () => number }
function make809(): R809 { return { a809: 1, m809: () => 1 }; }
function again809(): R809 { return make809(); }
function get809(): unknown { return again809().m809; }
function hit809(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c809(): void { say("record/maker-forwarded-and-returned/switch", hit809((get809()), (get809()))); }

interface R810 { a810: number; m810: () => number }
function make810(): R810 { return { a810: 1, m810: () => 1 }; }
function again810(): R810 { return make810(); }
function get810(): unknown { return again810().m810; }
let last810: unknown;`,
      [
        `seen810(f: unknown): boolean { const same = f === last810; last810 = f; return same	0(): void { say("record/maker-forwarded-and-returned/kept-then-compared", (seen810((get810())), seen810((get810())))
build811(f: () => R811): R811 { return f()	1(): void { say("record/maker-as-a-callback/strict-eq", (build811(make811).m811) === (build811(make811).m811)
build812(f: () => R812): R812 { return f()	2(): void { say("record/maker-as-a-callback/strict-ne", (build812(make812).m812) !== (build812(make812).m812)
build813(f: () => R813): R813 { return f()	3(): void { say("record/maker-as-a-callback/loose-eq", (build813(make813).m813) == (build813(make813).m813)
build814(f: () => R814): R814 { return f()	4(): void { say("record/maker-as-a-callback/object-is", Object.is((build814(make814).m814), (build814(make814).m814))
build815(f: () => R815): R815 { return f()	5(): void { say("record/maker-as-a-callback/set", new Set([(build815(make815).m815), (build815(make815).m815)]).size
build816(f: () => R816): R816 { return f()	6(): void { say("record/maker-as-a-callback/map-key", new Map([[(build816(make816).m816), 1], [(build816(make816).m816), 2]]).size
build817(f: () => R817): R817 { return f()	7(): void { say("record/maker-as-a-callback/includes", [(build817(make817).m817)].includes((build817(make817).m817))
build818(f: () => R818): R818 { return f()	8(): void { say("record/maker-as-a-callback/index-of", [(build818(make818).m818)].indexOf((build818(make818).m818))`,
        (n, a, b) => `function ${a}; }
function c81${b}); }

interface R${n + 811} { a${n + 811}: number; m${n + 811}: () => number }
function make${n + 811}(): R${n + 811} { return { a${n + 811}: 1, m${n + 811}: () => 1 }; }`,
      ],
      `function build819(f: () => R819): R819 { return f(); }
const ws819 = new WeakSet<object>();
function c819(): void { say("record/maker-as-a-callback/weak-set", (ws819.add((build819(make819).m819) as object), ws819.has((build819(make819).m819) as object))); }

interface R820 { a820: number; m820: () => number }
function make820(): R820 { return { a820: 1, m820: () => 1 }; }
function build820(f: () => R820): R820 { return f(); }
const wm820 = new WeakMap<object, number>();`,
      [
        `0(): void { say("record/maker-as-a-callback/weak-map", (wm820.set((build820(make820).m820) as object, 1), wm820.has((build820(make820).m820) as object)
1(): void { say("record/maker-as-a-callback/written", ((((build821(make821).m821)) as any).tag = 1, (((build821(make821).m821)) as any).tag
2(): void { say("record/maker-as-a-callback/defined", (Object.defineProperty((build822(make822).m822) as object, "t", { value: 1 }), "t" in ((build822(make822).m822) as object)
3(): void { say("record/maker-as-a-callback/frozen", (Object.freeze((build823(make823).m823)), Object.isFrozen((build823(make823).m823))
4(): void { say("record/maker-as-a-callback/prototype-set", (Object.setPrototypeOf((build824(make824).m824) as object, null), Object.getPrototypeOf((build824(make824).m824)) === null
5(): void { say("record/maker-as-a-callback/deleted", (delete (((build825(make825).m825)) as any).length, Object.hasOwn((build825(make825).m825) as object, "length")`,
        (n, a) => `function c82${a})); }

interface R${n + 821} { a${n + 821}: number; m${n + 821}: () => number }
function make${n + 821}(): R${n + 821} { return { a${n + 821}: 1, m${n + 821}: () => 1 }; }
function build${n + 821}(f: () => R${n + 821}): R${n + 821} { return f(); }`,
      ],
      `function same826(a: unknown, b: unknown): boolean { return a === b; }
function c826(): void { say("record/maker-as-a-callback/in-a-callee", same826((build826(make826).m826), (build826(make826).m826))); }

interface R827 { a827: number; m827: () => number }
function make827(): R827 { return { a827: 1, m827: () => 1 }; }
function build827(f: () => R827): R827 { return f(); }
function hit827(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c827(): void { say("record/maker-as-a-callback/switch", hit827((build827(make827).m827), (build827(make827).m827))); }

interface R828 { a828: number; m828: () => number }
function make828(): R828 { return { a828: 1, m828: () => 1 }; }
function build828(f: () => R828): R828 { return f(); }
let last828: unknown;`,
      [
        `seen828(f: unknown): boolean { const same = f === last828; last828 = f; return same	28(): void { say("record/maker-as-a-callback/kept-then-compared", (seen828((build828(make828).m828)), seen828((build828(make828).m828)))
get829(): unknown { return build829(make829).m829	29(): void { say("record/maker-as-a-callback-returned/strict-eq", (get829()) === (get829())
get830(): unknown { return build830(make830).m830	30(): void { say("record/maker-as-a-callback-returned/strict-ne", (get830()) !== (get830())
get831(): unknown { return build831(make831).m831	31(): void { say("record/maker-as-a-callback-returned/loose-eq", (get831()) == (get831())
get832(): unknown { return build832(make832).m832	32(): void { say("record/maker-as-a-callback-returned/object-is", Object.is((get832()), (get832()))
get833(): unknown { return build833(make833).m833	33(): void { say("record/maker-as-a-callback-returned/set", new Set([(get833()), (get833())]).size
get834(): unknown { return build834(make834).m834	34(): void { say("record/maker-as-a-callback-returned/map-key", new Map([[(get834()), 1], [(get834()), 2]]).size
get835(): unknown { return build835(make835).m835	35(): void { say("record/maker-as-a-callback-returned/includes", [(get835())].includes((get835()))
get836(): unknown { return build836(make836).m836	36(): void { say("record/maker-as-a-callback-returned/index-of", [(get836())].indexOf((get836()))`,
        (n, a, b) => `function ${a}; }
function c8${b}); }

interface R${n + 829} { a${n + 829}: number; m${n + 829}: () => number }
function make${n + 829}(): R${n + 829} { return { a${n + 829}: 1, m${n + 829}: () => 1 }; }
function build${n + 829}(f: () => R${n + 829}): R${n + 829} { return f(); }`,
      ],
      `function get837(): unknown { return build837(make837).m837; }
const ws837 = new WeakSet<object>();
function c837(): void { say("record/maker-as-a-callback-returned/weak-set", (ws837.add((get837()) as object), ws837.has((get837()) as object))); }

interface R838 { a838: number; m838: () => number }
function make838(): R838 { return { a838: 1, m838: () => 1 }; }
function build838(f: () => R838): R838 { return f(); }
function get838(): unknown { return build838(make838).m838; }
const wm838 = new WeakMap<object, number>();
function c838(): void { say("record/maker-as-a-callback-returned/weak-map", (wm838.set((get838()) as object, 1), wm838.has((get838()) as object))); }

interface R839 { a839: number; m839: () => number }
function make839(): R839 { return { a839: 1, m839: () => 1 }; }
function build839(f: () => R839): R839 { return f(); }
function get839(): unknown { return build839(make839).m839; }
function c839(): void { say("record/maker-as-a-callback-returned/written", ((((get839())) as any).tag = 1, (((get839())) as any).tag)); }

interface R840 { a840: number; m840: () => number }
function make840(): R840 { return { a840: 1, m840: () => 1 }; }
function build840(f: () => R840): R840 { return f(); }
function get840(): unknown { return build840(make840).m840; }
function c840(): void { say("record/maker-as-a-callback-returned/defined", (Object.defineProperty((get840()) as object, "t", { value: 1 }), "t" in ((get840()) as object))); }

c781(); c782(); c783(); c784(); c785(); c786(); c787(); c788(); c789(); c790(); c791(); c792(); c793(); c794(); c795(); c796(); c797(); c798(); c799(); c800(); c801(); c802(); c803(); c804(); c805(); c806(); c807(); c808(); c809(); c810(); c811(); c812(); c813(); c814(); c815(); c816(); c817(); c818(); c819(); c820(); c821(); c822(); c823(); c824(); c825(); c826(); c827(); c828(); c829(); c830(); c831(); c832(); c833(); c834(); c835(); c836(); c837(); c838(); c839(); c840();
console.log(out.join("\\n"));
`,
    ),
    "identity2-14.ts": text(
      `// Generated program: object and closure identity stays observable when allocations are removed (second series, part 14).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R841 { a841: number; m841: () => number }
function make841(): R841 { return { a841: 1, m841: () => 1 }; }
function build841(f: () => R841): R841 { return f(); }
function get841(): unknown { return build841(make841).m841; }
function c841(): void { say("record/maker-as-a-callback-returned/frozen", (Object.freeze((get841())), Object.isFrozen((get841())))); }

interface R842 { a842: number; m842: () => number }
function make842(): R842 { return { a842: 1, m842: () => 1 }; }
function build842(f: () => R842): R842 { return f(); }
function get842(): unknown { return build842(make842).m842; }
function c842(): void { say("record/maker-as-a-callback-returned/prototype-set", (Object.setPrototypeOf((get842()) as object, null), Object.getPrototypeOf((get842())) === null)); }

interface R843 { a843: number; m843: () => number }
function make843(): R843 { return { a843: 1, m843: () => 1 }; }
function build843(f: () => R843): R843 { return f(); }
function get843(): unknown { return build843(make843).m843; }
function c843(): void { say("record/maker-as-a-callback-returned/deleted", (delete (((get843())) as any).length, Object.hasOwn((get843()) as object, "length"))); }

interface R844 { a844: number; m844: () => number }
function make844(): R844 { return { a844: 1, m844: () => 1 }; }
function build844(f: () => R844): R844 { return f(); }
function get844(): unknown { return build844(make844).m844; }
function same844(a: unknown, b: unknown): boolean { return a === b; }
function c844(): void { say("record/maker-as-a-callback-returned/in-a-callee", same844((get844()), (get844()))); }

interface R845 { a845: number; m845: () => number }
function make845(): R845 { return { a845: 1, m845: () => 1 }; }
function build845(f: () => R845): R845 { return f(); }
function get845(): unknown { return build845(make845).m845; }
function hit845(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c845(): void { say("record/maker-as-a-callback-returned/switch", hit845((get845()), (get845()))); }

interface R846 { a846: number; m846: () => number }
function make846(): R846 { return { a846: 1, m846: () => 1 }; }
function build846(f: () => R846): R846 { return f(); }
function get846(): unknown { return build846(make846).m846; }
let last846: unknown;`,
      [
        `seen846(f: unknown): boolean { const same = f === last846; last846 = f; return same	46(): void { say("record/maker-as-a-callback-returned/kept-then-compared", (seen846((get846())), seen846((get846())))
get847(): unknown { return box847().t.m847	47(): void { say("record/holder-through-a-record/strict-eq", (get847()) === (get847())
get848(): unknown { return box848().t.m848	48(): void { say("record/holder-through-a-record/strict-ne", (get848()) !== (get848())
get849(): unknown { return box849().t.m849	49(): void { say("record/holder-through-a-record/loose-eq", (get849()) == (get849())
get850(): unknown { return box850().t.m850	50(): void { say("record/holder-through-a-record/object-is", Object.is((get850()), (get850()))
get851(): unknown { return box851().t.m851	51(): void { say("record/holder-through-a-record/set", new Set([(get851()), (get851())]).size
get852(): unknown { return box852().t.m852	52(): void { say("record/holder-through-a-record/map-key", new Map([[(get852()), 1], [(get852()), 2]]).size
get853(): unknown { return box853().t.m853	53(): void { say("record/holder-through-a-record/includes", [(get853())].includes((get853()))
get854(): unknown { return box854().t.m854	54(): void { say("record/holder-through-a-record/index-of", [(get854())].indexOf((get854()))`,
        (n, a, b) => `function ${a}; }
function c8${b}); }

interface R${n + 847} { a${n + 847}: number; m${n + 847}: () => number }
function make${n + 847}(): R${n + 847} { return { a${n + 847}: 1, m${n + 847}: () => 1 }; }
function box${n + 847}(): { t: R${n + 847} } { return { t: make${n + 847}() }; }`,
      ],
      `function get855(): unknown { return box855().t.m855; }
const ws855 = new WeakSet<object>();
function c855(): void { say("record/holder-through-a-record/weak-set", (ws855.add((get855()) as object), ws855.has((get855()) as object))); }

interface R856 { a856: number; m856: () => number }
function make856(): R856 { return { a856: 1, m856: () => 1 }; }
function box856(): { t: R856 } { return { t: make856() }; }
function get856(): unknown { return box856().t.m856; }
const wm856 = new WeakMap<object, number>();`,
      [
        `56(): void { say("record/holder-through-a-record/weak-map", (wm856.set((get856()) as object, 1), wm856.has((get856()) as object)
57(): void { say("record/holder-through-a-record/written", ((((get857())) as any).tag = 1, (((get857())) as any).tag
58(): void { say("record/holder-through-a-record/defined", (Object.defineProperty((get858()) as object, "t", { value: 1 }), "t" in ((get858()) as object)
59(): void { say("record/holder-through-a-record/frozen", (Object.freeze((get859())), Object.isFrozen((get859()))
60(): void { say("record/holder-through-a-record/prototype-set", (Object.setPrototypeOf((get860()) as object, null), Object.getPrototypeOf((get860())) === null
61(): void { say("record/holder-through-a-record/deleted", (delete (((get861())) as any).length, Object.hasOwn((get861()) as object, "length")`,
        (n, a) => `function c8${a})); }

interface R${n + 857} { a${n + 857}: number; m${n + 857}: () => number }
function make${n + 857}(): R${n + 857} { return { a${n + 857}: 1, m${n + 857}: () => 1 }; }
function box${n + 857}(): { t: R${n + 857} } { return { t: make${n + 857}() }; }
function get${n + 857}(): unknown { return box${n + 857}().t.m${n + 857}; }`,
      ],
      `function same862(a: unknown, b: unknown): boolean { return a === b; }
function c862(): void { say("record/holder-through-a-record/in-a-callee", same862((get862()), (get862()))); }

interface R863 { a863: number; m863: () => number }
function make863(): R863 { return { a863: 1, m863: () => 1 }; }
function box863(): { t: R863 } { return { t: make863() }; }
function get863(): unknown { return box863().t.m863; }
function hit863(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c863(): void { say("record/holder-through-a-record/switch", hit863((get863()), (get863()))); }

interface R864 { a864: number; m864: () => number }
function make864(): R864 { return { a864: 1, m864: () => 1 }; }
function box864(): { t: R864 } { return { t: make864() }; }
function get864(): unknown { return box864().t.m864; }
let last864: unknown;`,
      [
        `seen864(f: unknown): boolean { const same = f === last864; last864 = f; return same	64(): void { say("record/holder-through-a-record/kept-then-compared", (seen864((get864())), seen864((get864())))
get865(): unknown { return box865()[0].m865	65(): void { say("record/holder-through-an-array/strict-eq", (get865()) === (get865())
get866(): unknown { return box866()[0].m866	66(): void { say("record/holder-through-an-array/strict-ne", (get866()) !== (get866())
get867(): unknown { return box867()[0].m867	67(): void { say("record/holder-through-an-array/loose-eq", (get867()) == (get867())
get868(): unknown { return box868()[0].m868	68(): void { say("record/holder-through-an-array/object-is", Object.is((get868()), (get868()))
get869(): unknown { return box869()[0].m869	69(): void { say("record/holder-through-an-array/set", new Set([(get869()), (get869())]).size
get870(): unknown { return box870()[0].m870	70(): void { say("record/holder-through-an-array/map-key", new Map([[(get870()), 1], [(get870()), 2]]).size
get871(): unknown { return box871()[0].m871	71(): void { say("record/holder-through-an-array/includes", [(get871())].includes((get871()))
get872(): unknown { return box872()[0].m872	72(): void { say("record/holder-through-an-array/index-of", [(get872())].indexOf((get872()))`,
        (n, a, b) => `function ${a}; }
function c8${b}); }

interface R${n + 865} { a${n + 865}: number; m${n + 865}: () => number }
function make${n + 865}(): R${n + 865} { return { a${n + 865}: 1, m${n + 865}: () => 1 }; }
function box${n + 865}(): Array<R${n + 865}> { return [make${n + 865}()]; }`,
      ],
      `function get873(): unknown { return box873()[0].m873; }
const ws873 = new WeakSet<object>();
function c873(): void { say("record/holder-through-an-array/weak-set", (ws873.add((get873()) as object), ws873.has((get873()) as object))); }

interface R874 { a874: number; m874: () => number }
function make874(): R874 { return { a874: 1, m874: () => 1 }; }
function box874(): Array<R874> { return [make874()]; }
function get874(): unknown { return box874()[0].m874; }
const wm874 = new WeakMap<object, number>();`,
      [
        `4(): void { say("record/holder-through-an-array/weak-map", (wm874.set((get874()) as object, 1), wm874.has((get874()) as object)
5(): void { say("record/holder-through-an-array/written", ((((get875())) as any).tag = 1, (((get875())) as any).tag
6(): void { say("record/holder-through-an-array/defined", (Object.defineProperty((get876()) as object, "t", { value: 1 }), "t" in ((get876()) as object)
7(): void { say("record/holder-through-an-array/frozen", (Object.freeze((get877())), Object.isFrozen((get877()))
8(): void { say("record/holder-through-an-array/prototype-set", (Object.setPrototypeOf((get878()) as object, null), Object.getPrototypeOf((get878())) === null
9(): void { say("record/holder-through-an-array/deleted", (delete (((get879())) as any).length, Object.hasOwn((get879()) as object, "length")`,
        (n, a) => `function c87${a})); }

interface R${n + 875} { a${n + 875}: number; m${n + 875}: () => number }
function make${n + 875}(): R${n + 875} { return { a${n + 875}: 1, m${n + 875}: () => 1 }; }
function box${n + 875}(): Array<R${n + 875}> { return [make${n + 875}()]; }
function get${n + 875}(): unknown { return box${n + 875}()[0].m${n + 875}; }`,
      ],
      `function same880(a: unknown, b: unknown): boolean { return a === b; }
function c880(): void { say("record/holder-through-an-array/in-a-callee", same880((get880()), (get880()))); }

interface R881 { a881: number; m881: () => number }
function make881(): R881 { return { a881: 1, m881: () => 1 }; }
function box881(): Array<R881> { return [make881()]; }
function get881(): unknown { return box881()[0].m881; }
function hit881(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c881(): void { say("record/holder-through-an-array/switch", hit881((get881()), (get881()))); }

interface R882 { a882: number; m882: () => number }
function make882(): R882 { return { a882: 1, m882: () => 1 }; }
function box882(): Array<R882> { return [make882()]; }
function get882(): unknown { return box882()[0].m882; }
let last882: unknown;`,
      [
        `seen882(f: unknown): boolean { const same = f === last882; last882 = f; return same	82(): void { say("record/holder-through-an-array/kept-then-compared", (seen882((get882())), seen882((get882())))
get883(): unknown { return box883()().m883	83(): void { say("record/holder-through-a-closure/strict-eq", (get883()) === (get883())
get884(): unknown { return box884()().m884	84(): void { say("record/holder-through-a-closure/strict-ne", (get884()) !== (get884())
get885(): unknown { return box885()().m885	85(): void { say("record/holder-through-a-closure/loose-eq", (get885()) == (get885())
get886(): unknown { return box886()().m886	86(): void { say("record/holder-through-a-closure/object-is", Object.is((get886()), (get886()))
get887(): unknown { return box887()().m887	87(): void { say("record/holder-through-a-closure/set", new Set([(get887()), (get887())]).size
get888(): unknown { return box888()().m888	88(): void { say("record/holder-through-a-closure/map-key", new Map([[(get888()), 1], [(get888()), 2]]).size
get889(): unknown { return box889()().m889	89(): void { say("record/holder-through-a-closure/includes", [(get889())].includes((get889()))
get890(): unknown { return box890()().m890	90(): void { say("record/holder-through-a-closure/index-of", [(get890())].indexOf((get890()))`,
        (n, a, b) => `function ${a}; }
function c8${b}); }

interface R${n + 883} { a${n + 883}: number; m${n + 883}: () => number }
function make${n + 883}(): R${n + 883} { return { a${n + 883}: 1, m${n + 883}: () => 1 }; }
function box${n + 883}(): () => R${n + 883} { const t = make${n + 883}(); return () => t; }`,
      ],
      `function get891(): unknown { return box891()().m891; }
const ws891 = new WeakSet<object>();
function c891(): void { say("record/holder-through-a-closure/weak-set", (ws891.add((get891()) as object), ws891.has((get891()) as object))); }

interface R892 { a892: number; m892: () => number }
function make892(): R892 { return { a892: 1, m892: () => 1 }; }
function box892(): () => R892 { const t = make892(); return () => t; }
function get892(): unknown { return box892()().m892; }
const wm892 = new WeakMap<object, number>();`,
      [
        `2(): void { say("record/holder-through-a-closure/weak-map", (wm892.set((get892()) as object, 1), wm892.has((get892()) as object)
3(): void { say("record/holder-through-a-closure/written", ((((get893())) as any).tag = 1, (((get893())) as any).tag
4(): void { say("record/holder-through-a-closure/defined", (Object.defineProperty((get894()) as object, "t", { value: 1 }), "t" in ((get894()) as object)
5(): void { say("record/holder-through-a-closure/frozen", (Object.freeze((get895())), Object.isFrozen((get895()))
6(): void { say("record/holder-through-a-closure/prototype-set", (Object.setPrototypeOf((get896()) as object, null), Object.getPrototypeOf((get896())) === null
7(): void { say("record/holder-through-a-closure/deleted", (delete (((get897())) as any).length, Object.hasOwn((get897()) as object, "length")`,
        (n, a) => `function c89${a})); }

interface R${n + 893} { a${n + 893}: number; m${n + 893}: () => number }
function make${n + 893}(): R${n + 893} { return { a${n + 893}: 1, m${n + 893}: () => 1 }; }
function box${n + 893}(): () => R${n + 893} { const t = make${n + 893}(); return () => t; }
function get${n + 893}(): unknown { return box${n + 893}()().m${n + 893}; }`,
      ],
      `function same898(a: unknown, b: unknown): boolean { return a === b; }
function c898(): void { say("record/holder-through-a-closure/in-a-callee", same898((get898()), (get898()))); }

interface R899 { a899: number; m899: () => number }
function make899(): R899 { return { a899: 1, m899: () => 1 }; }
function box899(): () => R899 { const t = make899(); return () => t; }
function get899(): unknown { return box899()().m899; }
function hit899(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c899(): void { say("record/holder-through-a-closure/switch", hit899((get899()), (get899()))); }

interface R900 { a900: number; m900: () => number }
function make900(): R900 { return { a900: 1, m900: () => 1 }; }
function box900(): () => R900 { const t = make900(); return () => t; }
function get900(): unknown { return box900()().m900; }
let last900: unknown;
function seen900(f: unknown): boolean { const same = f === last900; last900 = f; return same; }
function c900(): void { say("record/holder-through-a-closure/kept-then-compared", (seen900((get900())), seen900((get900())))); }

c841(); c842(); c843(); c844(); c845(); c846(); c847(); c848(); c849(); c850(); c851(); c852(); c853(); c854(); c855(); c856(); c857(); c858(); c859(); c860(); c861(); c862(); c863(); c864(); c865(); c866(); c867(); c868(); c869(); c870(); c871(); c872(); c873(); c874(); c875(); c876(); c877(); c878(); c879(); c880(); c881(); c882(); c883(); c884(); c885(); c886(); c887(); c888(); c889(); c890(); c891(); c892(); c893(); c894(); c895(); c896(); c897(); c898(); c899(); c900();
console.log(out.join("\\n"));
`,
    ),
    "identity2-15.ts": text(
      `// Generated program: object and closure identity stays observable when allocations are removed (second series, part 15).
declare const console: any;
const out: string[] = [];`,
      [
        `say(name: string, value: unknown): void { out.push(name + "=" + String(value)
c901(): void { say("record/finally/strict-eq", (get901()) === (get901())
c902(): void { say("record/finally/strict-ne", (get902()) !== (get902())
c903(): void { say("record/finally/loose-eq", (get903()) == (get903())
c904(): void { say("record/finally/object-is", Object.is((get904()), (get904()))
c905(): void { say("record/finally/set", new Set([(get905()), (get905())]).size
c906(): void { say("record/finally/map-key", new Map([[(get906()), 1], [(get906()), 2]]).size
c907(): void { say("record/finally/includes", [(get907())].includes((get907()))
c908(): void { say("record/finally/index-of", [(get908())].indexOf((get908()))`,
        (n, a) => `function ${a}); }

interface R${n + 901} { a${n + 901}: number; m${n + 901}: () => number }
function make${n + 901}(): R${n + 901} { return { a${n + 901}: 1, m${n + 901}: () => 1 }; }
function get${n + 901}(): unknown { try { return make${n + 901}().m${n + 901}; } finally { out.length; } }`,
      ],
      `const ws909 = new WeakSet<object>();
function c909(): void { say("record/finally/weak-set", (ws909.add((get909()) as object), ws909.has((get909()) as object))); }

interface R910 { a910: number; m910: () => number }
function make910(): R910 { return { a910: 1, m910: () => 1 }; }
function get910(): unknown { try { return make910().m910; } finally { out.length; } }
const wm910 = new WeakMap<object, number>();`,
      [
        `0(): void { say("record/finally/weak-map", (wm910.set((get910()) as object, 1), wm910.has((get910()) as object)
1(): void { say("record/finally/written", ((((get911())) as any).tag = 1, (((get911())) as any).tag
2(): void { say("record/finally/defined", (Object.defineProperty((get912()) as object, "t", { value: 1 }), "t" in ((get912()) as object)
3(): void { say("record/finally/frozen", (Object.freeze((get913())), Object.isFrozen((get913()))
4(): void { say("record/finally/prototype-set", (Object.setPrototypeOf((get914()) as object, null), Object.getPrototypeOf((get914())) === null
5(): void { say("record/finally/deleted", (delete (((get915())) as any).length, Object.hasOwn((get915()) as object, "length")`,
        (n, a) => `function c91${a})); }

interface R${n + 911} { a${n + 911}: number; m${n + 911}: () => number }
function make${n + 911}(): R${n + 911} { return { a${n + 911}: 1, m${n + 911}: () => 1 }; }
function get${n + 911}(): unknown { try { return make${n + 911}().m${n + 911}; } finally { out.length; } }`,
      ],
      `function same916(a: unknown, b: unknown): boolean { return a === b; }
function c916(): void { say("record/finally/in-a-callee", same916((get916()), (get916()))); }

interface R917 { a917: number; m917: () => number }
function make917(): R917 { return { a917: 1, m917: () => 1 }; }
function get917(): unknown { try { return make917().m917; } finally { out.length; } }
function hit917(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c917(): void { say("record/finally/switch", hit917((get917()), (get917()))); }

interface R918 { a918: number; m918: () => number }
function make918(): R918 { return { a918: 1, m918: () => 1 }; }
function get918(): unknown { try { return make918().m918; } finally { out.length; } }
let last918: unknown;
function seen918(f: unknown): boolean { const same = f === last918; last918 = f; return same; }`,
      [
        `18(): void { say("record/finally/kept-then-compared", (seen918((get918())), seen918((get918())))
19(): void { say("record/switch-arm/strict-eq", (get919(1)) === (get919(1))
20(): void { say("record/switch-arm/strict-ne", (get920(1)) !== (get920(1))
21(): void { say("record/switch-arm/loose-eq", (get921(1)) == (get921(1))
22(): void { say("record/switch-arm/object-is", Object.is((get922(1)), (get922(1)))
23(): void { say("record/switch-arm/set", new Set([(get923(1)), (get923(1))]).size
24(): void { say("record/switch-arm/map-key", new Map([[(get924(1)), 1], [(get924(1)), 2]]).size
25(): void { say("record/switch-arm/includes", [(get925(1))].includes((get925(1)))
26(): void { say("record/switch-arm/index-of", [(get926(1))].indexOf((get926(1)))`,
        (n, a) => `function c9${a}); }

interface R${n + 919} { a${n + 919}: number; m${n + 919}: () => number }
function make${n + 919}(): R${n + 919} { return { a${n + 919}: 1, m${n + 919}: () => 1 }; }
function get${n + 919}(n: number): unknown { switch (n) { case 1: return make${n + 919}().m${n + 919}; default: return 0; } }`,
      ],
      `const ws927 = new WeakSet<object>();
function c927(): void { say("record/switch-arm/weak-set", (ws927.add((get927(1)) as object), ws927.has((get927(1)) as object))); }

interface R928 { a928: number; m928: () => number }
function make928(): R928 { return { a928: 1, m928: () => 1 }; }
function get928(n: number): unknown { switch (n) { case 1: return make928().m928; default: return 0; } }
const wm928 = new WeakMap<object, number>();`,
      [
        `28(): void { say("record/switch-arm/weak-map", (wm928.set((get928(1)) as object, 1), wm928.has((get928(1)) as object)
29(): void { say("record/switch-arm/written", ((((get929(1))) as any).tag = 1, (((get929(1))) as any).tag
30(): void { say("record/switch-arm/defined", (Object.defineProperty((get930(1)) as object, "t", { value: 1 }), "t" in ((get930(1)) as object)
31(): void { say("record/switch-arm/frozen", (Object.freeze((get931(1))), Object.isFrozen((get931(1)))
32(): void { say("record/switch-arm/prototype-set", (Object.setPrototypeOf((get932(1)) as object, null), Object.getPrototypeOf((get932(1))) === null
33(): void { say("record/switch-arm/deleted", (delete (((get933(1))) as any).length, Object.hasOwn((get933(1)) as object, "length")`,
        (n, a) => `function c9${a})); }

interface R${n + 929} { a${n + 929}: number; m${n + 929}: () => number }
function make${n + 929}(): R${n + 929} { return { a${n + 929}: 1, m${n + 929}: () => 1 }; }
function get${n + 929}(n: number): unknown { switch (n) { case 1: return make${n + 929}().m${n + 929}; default: return 0; } }`,
      ],
      `function same934(a: unknown, b: unknown): boolean { return a === b; }
function c934(): void { say("record/switch-arm/in-a-callee", same934((get934(1)), (get934(1)))); }

interface R935 { a935: number; m935: () => number }
function make935(): R935 { return { a935: 1, m935: () => 1 }; }
function get935(n: number): unknown { switch (n) { case 1: return make935().m935; default: return 0; } }
function hit935(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c935(): void { say("record/switch-arm/switch", hit935((get935(1)), (get935(1)))); }

interface R936 { a936: number; m936: () => number }
function make936(): R936 { return { a936: 1, m936: () => 1 }; }
function get936(n: number): unknown { switch (n) { case 1: return make936().m936; default: return 0; } }
let last936: unknown;`,
      [
        `seen936(f: unknown): boolean { const same = f === last936; last936 = f; return same	36(): void { say("record/switch-arm/kept-then-compared", (seen936((get936(1))), seen936((get936(1))))
make937(): R937 { return { a937: 1, m937: () => 1 }	37(): void { say("record/object-from-entries/strict-eq", (Object.fromEntries([["k", make937().m937]]).k) === (Object.fromEntries([["k", make937().m937]]).k)
make938(): R938 { return { a938: 1, m938: () => 1 }	38(): void { say("record/object-from-entries/strict-ne", (Object.fromEntries([["k", make938().m938]]).k) !== (Object.fromEntries([["k", make938().m938]]).k)
make939(): R939 { return { a939: 1, m939: () => 1 }	39(): void { say("record/object-from-entries/loose-eq", (Object.fromEntries([["k", make939().m939]]).k) == (Object.fromEntries([["k", make939().m939]]).k)
make940(): R940 { return { a940: 1, m940: () => 1 }	40(): void { say("record/object-from-entries/object-is", Object.is((Object.fromEntries([["k", make940().m940]]).k), (Object.fromEntries([["k", make940().m940]]).k))
make941(): R941 { return { a941: 1, m941: () => 1 }	41(): void { say("record/object-from-entries/set", new Set([(Object.fromEntries([["k", make941().m941]]).k), (Object.fromEntries([["k", make941().m941]]).k)]).size
make942(): R942 { return { a942: 1, m942: () => 1 }	42(): void { say("record/object-from-entries/map-key", new Map([[(Object.fromEntries([["k", make942().m942]]).k), 1], [(Object.fromEntries([["k", make942().m942]]).k), 2]]).size
make943(): R943 { return { a943: 1, m943: () => 1 }	43(): void { say("record/object-from-entries/includes", [(Object.fromEntries([["k", make943().m943]]).k)].includes((Object.fromEntries([["k", make943().m943]]).k))
make944(): R944 { return { a944: 1, m944: () => 1 }	44(): void { say("record/object-from-entries/index-of", [(Object.fromEntries([["k", make944().m944]]).k)].indexOf((Object.fromEntries([["k", make944().m944]]).k))`,
        (n, a, b) => `function ${a}; }
function c9${b}); }

interface R${n + 937} { a${n + 937}: number; m${n + 937}: () => number }`,
      ],
      `function make945(): R945 { return { a945: 1, m945: () => 1 }; }
const ws945 = new WeakSet<object>();
function c945(): void { say("record/object-from-entries/weak-set", (ws945.add((Object.fromEntries([["k", make945().m945]]).k) as object), ws945.has((Object.fromEntries([["k", make945().m945]]).k) as object))); }

interface R946 { a946: number; m946: () => number }
function make946(): R946 { return { a946: 1, m946: () => 1 }; }
const wm946 = new WeakMap<object, number>();
function c946(): void { say("record/object-from-entries/weak-map", (wm946.set((Object.fromEntries([["k", make946().m946]]).k) as object, 1), wm946.has((Object.fromEntries([["k", make946().m946]]).k) as object))); }

interface R947 { a947: number; m947: () => number }
function make947(): R947 { return { a947: 1, m947: () => 1 }; }
function c947(): void { say("record/object-from-entries/written", ((((Object.fromEntries([["k", make947().m947]]).k)) as any).tag = 1, (((Object.fromEntries([["k", make947().m947]]).k)) as any).tag)); }

interface R948 { a948: number; m948: () => number }
function make948(): R948 { return { a948: 1, m948: () => 1 }; }
function c948(): void { say("record/object-from-entries/defined", (Object.defineProperty((Object.fromEntries([["k", make948().m948]]).k) as object, "t", { value: 1 }), "t" in ((Object.fromEntries([["k", make948().m948]]).k) as object))); }

interface R949 { a949: number; m949: () => number }
function make949(): R949 { return { a949: 1, m949: () => 1 }; }
function c949(): void { say("record/object-from-entries/frozen", (Object.freeze((Object.fromEntries([["k", make949().m949]]).k)), Object.isFrozen((Object.fromEntries([["k", make949().m949]]).k)))); }

interface R950 { a950: number; m950: () => number }
function make950(): R950 { return { a950: 1, m950: () => 1 }; }
function c950(): void { say("record/object-from-entries/prototype-set", (Object.setPrototypeOf((Object.fromEntries([["k", make950().m950]]).k) as object, null), Object.getPrototypeOf((Object.fromEntries([["k", make950().m950]]).k)) === null)); }

interface R951 { a951: number; m951: () => number }
function make951(): R951 { return { a951: 1, m951: () => 1 }; }
function c951(): void { say("record/object-from-entries/deleted", (delete (((Object.fromEntries([["k", make951().m951]]).k)) as any).length, Object.hasOwn((Object.fromEntries([["k", make951().m951]]).k) as object, "length"))); }

interface R952 { a952: number; m952: () => number }
function make952(): R952 { return { a952: 1, m952: () => 1 }; }
function same952(a: unknown, b: unknown): boolean { return a === b; }
function c952(): void { say("record/object-from-entries/in-a-callee", same952((Object.fromEntries([["k", make952().m952]]).k), (Object.fromEntries([["k", make952().m952]]).k))); }

interface R953 { a953: number; m953: () => number }
function make953(): R953 { return { a953: 1, m953: () => 1 }; }
function hit953(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c953(): void { say("record/object-from-entries/switch", hit953((Object.fromEntries([["k", make953().m953]]).k), (Object.fromEntries([["k", make953().m953]]).k))); }

interface R954 { a954: number; m954: () => number }
function make954(): R954 { return { a954: 1, m954: () => 1 }; }
let last954: unknown;`,
      [
        `seen954(f: unknown): boolean { const same = f === last954; last954 = f; return same	4(): void { say("record/object-from-entries/kept-then-compared", (seen954((Object.fromEntries([["k", make954().m954]]).k)), seen954((Object.fromEntries([["k", make954().m954]]).k)))
get955(): unknown { const t = make955(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m955	5(): void { say("record/structured-holder/strict-eq", (get955()) === (get955())
get956(): unknown { const t = make956(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m956	6(): void { say("record/structured-holder/strict-ne", (get956()) !== (get956())
get957(): unknown { const t = make957(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m957	7(): void { say("record/structured-holder/loose-eq", (get957()) == (get957())
get958(): unknown { const t = make958(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m958	8(): void { say("record/structured-holder/object-is", Object.is((get958()), (get958()))
get959(): unknown { const t = make959(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m959	9(): void { say("record/structured-holder/set", new Set([(get959()), (get959())]).size`,
        (n, a, b) => `function ${a}; }
function c95${b}); }

interface R${n + 955} { a${n + 955}: number; m${n + 955}: () => number }
function make${n + 955}(): R${n + 955} { return { a${n + 955}: 1, m${n + 955}: () => 1 }; }`,
      ],
      `function get960(): unknown { const t = make960(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m960; }
function c960(): void { say("record/structured-holder/map-key", new Map([[(get960()), 1], [(get960()), 2]]).size); }

c901(); c902(); c903(); c904(); c905(); c906(); c907(); c908(); c909(); c910(); c911(); c912(); c913(); c914(); c915(); c916(); c917(); c918(); c919(); c920(); c921(); c922(); c923(); c924(); c925(); c926(); c927(); c928(); c929(); c930(); c931(); c932(); c933(); c934(); c935(); c936(); c937(); c938(); c939(); c940(); c941(); c942(); c943(); c944(); c945(); c946(); c947(); c948(); c949(); c950(); c951(); c952(); c953(); c954(); c955(); c956(); c957(); c958(); c959(); c960();
console.log(out.join("\\n"));
`,
    ),
  });
