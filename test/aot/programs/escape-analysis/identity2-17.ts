// Generated program: object and closure identity stays observable when allocations are removed (second series, part 17).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R1021 { a1021: number; m1021: () => number }
interface O1021 { in1021: R1021; n1021: number }
function make1021(): O1021 { return { in1021: { a1021: 1, m1021: () => 1 }, n1021: 2 }; }
function box1021(): Array<O1021> { return [make1021()]; }
function get1021(): unknown { return box1021()[0].in1021.m1021; }
function c1021(): void { say("nested/holder-through-an-array/strict-eq", (get1021()) === (get1021())); }

interface R1022 { a1022: number; m1022: () => number }
interface O1022 { in1022: R1022; n1022: number }
function make1022(): O1022 { return { in1022: { a1022: 1, m1022: () => 1 }, n1022: 2 }; }
function box1022(): () => O1022 { const t = make1022(); return () => t; }
function get1022(): unknown { return box1022()().in1022.m1022; }
function c1022(): void { say("nested/holder-through-a-closure/strict-eq", (get1022()) === (get1022())); }

interface R1023 { a1023: number; m1023: () => number }
interface O1023 { in1023: R1023; n1023: number }
function make1023(): O1023 { return { in1023: { a1023: 1, m1023: () => 1 }, n1023: 2 }; }
function get1023(): unknown { try { return make1023().in1023.m1023; } finally { out.length; } }
function c1023(): void { say("nested/finally/strict-eq", (get1023()) === (get1023())); }

interface R1024 { a1024: number; m1024: () => number }
interface O1024 { in1024: R1024; n1024: number }
function make1024(): O1024 { return { in1024: { a1024: 1, m1024: () => 1 }, n1024: 2 }; }
function get1024(n: number): unknown { switch (n) { case 1: return make1024().in1024.m1024; default: return 0; } }
function c1024(): void { say("nested/switch-arm/strict-eq", (get1024(1)) === (get1024(1))); }

interface R1025 { a1025: number; m1025: () => number }
interface O1025 { in1025: R1025; n1025: number }
function make1025(): O1025 { return { in1025: { a1025: 1, m1025: () => 1 }, n1025: 2 }; }
function c1025(): void { say("nested/object-from-entries/strict-eq", (Object.fromEntries([["k", make1025().in1025.m1025]]).k) === (Object.fromEntries([["k", make1025().in1025.m1025]]).k)); }

interface R1026 { a1026: number; m1026: () => number }
interface O1026 { in1026: R1026; n1026: number }
function make1026(): O1026 { return { in1026: { a1026: 1, m1026: () => 1 }, n1026: 2 }; }
function get1026(): unknown { const t = make1026(); const u = { t, n: 1 }; const v = { u }; return v.u.t.in1026.m1026; }
function c1026(): void { say("nested/structured-holder/strict-eq", (get1026()) === (get1026())); }

interface R1027 { a1027: number; m1027: () => number }
interface O1027 { in1027: R1027; n1027: number }
function make1027(): O1027 { return { in1027: { a1027: 1, m1027: () => 1 }, n1027: 2 }; }
function box1027(): { t: O1027 } { return { t: make1027() }; }
function get1027(): unknown { return box1027().t.in1027.m1027; }
function c1027(): void { say("nested/holder-through-a-record/strict-ne", (get1027()) !== (get1027())); }

interface R1028 { a1028: number; m1028: () => number }
interface O1028 { in1028: R1028; n1028: number }
function make1028(): O1028 { return { in1028: { a1028: 1, m1028: () => 1 }, n1028: 2 }; }
function box1028(): { t: O1028 } { return { t: make1028() }; }
function get1028(): unknown { return box1028().t.in1028.m1028; }
function c1028(): void { say("nested/holder-through-a-record/loose-eq", (get1028()) == (get1028())); }

interface R1029 { a1029: number; m1029: () => number }
interface O1029 { in1029: R1029; n1029: number }
function make1029(): O1029 { return { in1029: { a1029: 1, m1029: () => 1 }, n1029: 2 }; }
function box1029(): { t: O1029 } { return { t: make1029() }; }
function get1029(): unknown { return box1029().t.in1029.m1029; }
function c1029(): void { say("nested/holder-through-a-record/object-is", Object.is((get1029()), (get1029()))); }

interface R1030 { a1030: number; m1030: () => number }
interface O1030 { in1030: R1030; n1030: number }
function make1030(): O1030 { return { in1030: { a1030: 1, m1030: () => 1 }, n1030: 2 }; }
function box1030(): { t: O1030 } { return { t: make1030() }; }
function get1030(): unknown { return box1030().t.in1030.m1030; }
function c1030(): void { say("nested/holder-through-a-record/set", new Set([(get1030()), (get1030())]).size); }

interface R1031 { a1031: number; m1031: () => number }
interface O1031 { in1031: R1031; n1031: number }
function make1031(): O1031 { return { in1031: { a1031: 1, m1031: () => 1 }, n1031: 2 }; }
function box1031(): { t: O1031 } { return { t: make1031() }; }
function get1031(): unknown { return box1031().t.in1031.m1031; }
function c1031(): void { say("nested/holder-through-a-record/map-key", new Map([[(get1031()), 1], [(get1031()), 2]]).size); }

interface R1032 { a1032: number; m1032: () => number }
interface O1032 { in1032: R1032; n1032: number }
function make1032(): O1032 { return { in1032: { a1032: 1, m1032: () => 1 }, n1032: 2 }; }
function box1032(): { t: O1032 } { return { t: make1032() }; }
function get1032(): unknown { return box1032().t.in1032.m1032; }
function c1032(): void { say("nested/holder-through-a-record/includes", [(get1032())].includes((get1032()))); }

interface R1033 { a1033: number; m1033: () => number }
interface O1033 { in1033: R1033; n1033: number }
function make1033(): O1033 { return { in1033: { a1033: 1, m1033: () => 1 }, n1033: 2 }; }
function box1033(): { t: O1033 } { return { t: make1033() }; }
function get1033(): unknown { return box1033().t.in1033.m1033; }
function c1033(): void { say("nested/holder-through-a-record/index-of", [(get1033())].indexOf((get1033()))); }

interface R1034 { a1034: number; m1034: () => number }
interface O1034 { in1034: R1034; n1034: number }
function make1034(): O1034 { return { in1034: { a1034: 1, m1034: () => 1 }, n1034: 2 }; }
function box1034(): { t: O1034 } { return { t: make1034() }; }
function get1034(): unknown { return box1034().t.in1034.m1034; }
const ws1034 = new WeakSet<object>();
function c1034(): void { say("nested/holder-through-a-record/weak-set", (ws1034.add((get1034()) as object), ws1034.has((get1034()) as object))); }

interface R1035 { a1035: number; m1035: () => number }
interface O1035 { in1035: R1035; n1035: number }
function make1035(): O1035 { return { in1035: { a1035: 1, m1035: () => 1 }, n1035: 2 }; }
function box1035(): { t: O1035 } { return { t: make1035() }; }
function get1035(): unknown { return box1035().t.in1035.m1035; }
const wm1035 = new WeakMap<object, number>();
function c1035(): void { say("nested/holder-through-a-record/weak-map", (wm1035.set((get1035()) as object, 1), wm1035.has((get1035()) as object))); }

interface R1036 { a1036: number; m1036: () => number }
interface O1036 { in1036: R1036; n1036: number }
function make1036(): O1036 { return { in1036: { a1036: 1, m1036: () => 1 }, n1036: 2 }; }
function box1036(): { t: O1036 } { return { t: make1036() }; }
function get1036(): unknown { return box1036().t.in1036.m1036; }
function c1036(): void { say("nested/holder-through-a-record/written", ((((get1036())) as any).tag = 1, (((get1036())) as any).tag)); }

interface R1037 { a1037: number; m1037: () => number }
interface O1037 { in1037: R1037; n1037: number }
function make1037(): O1037 { return { in1037: { a1037: 1, m1037: () => 1 }, n1037: 2 }; }
function box1037(): { t: O1037 } { return { t: make1037() }; }
function get1037(): unknown { return box1037().t.in1037.m1037; }
function c1037(): void { say("nested/holder-through-a-record/defined", (Object.defineProperty((get1037()) as object, "t", { value: 1 }), "t" in ((get1037()) as object))); }

interface R1038 { a1038: number; m1038: () => number }
interface O1038 { in1038: R1038; n1038: number }
function make1038(): O1038 { return { in1038: { a1038: 1, m1038: () => 1 }, n1038: 2 }; }
function box1038(): { t: O1038 } { return { t: make1038() }; }
function get1038(): unknown { return box1038().t.in1038.m1038; }
function c1038(): void { say("nested/holder-through-a-record/frozen", (Object.freeze((get1038())), Object.isFrozen((get1038())))); }

interface R1039 { a1039: number; m1039: () => number }
interface O1039 { in1039: R1039; n1039: number }
function make1039(): O1039 { return { in1039: { a1039: 1, m1039: () => 1 }, n1039: 2 }; }
function box1039(): { t: O1039 } { return { t: make1039() }; }
function get1039(): unknown { return box1039().t.in1039.m1039; }
function c1039(): void { say("nested/holder-through-a-record/prototype-set", (Object.setPrototypeOf((get1039()) as object, null), Object.getPrototypeOf((get1039())) === null)); }

interface R1040 { a1040: number; m1040: () => number }
interface O1040 { in1040: R1040; n1040: number }
function make1040(): O1040 { return { in1040: { a1040: 1, m1040: () => 1 }, n1040: 2 }; }
function box1040(): { t: O1040 } { return { t: make1040() }; }
function get1040(): unknown { return box1040().t.in1040.m1040; }
function c1040(): void { say("nested/holder-through-a-record/deleted", (delete (((get1040())) as any).length, Object.hasOwn((get1040()) as object, "length"))); }

interface R1041 { a1041: number; m1041: () => number }
interface O1041 { in1041: R1041; n1041: number }
function make1041(): O1041 { return { in1041: { a1041: 1, m1041: () => 1 }, n1041: 2 }; }
function box1041(): { t: O1041 } { return { t: make1041() }; }
function get1041(): unknown { return box1041().t.in1041.m1041; }
function same1041(a: unknown, b: unknown): boolean { return a === b; }
function c1041(): void { say("nested/holder-through-a-record/in-a-callee", same1041((get1041()), (get1041()))); }

interface R1042 { a1042: number; m1042: () => number }
interface O1042 { in1042: R1042; n1042: number }
function make1042(): O1042 { return { in1042: { a1042: 1, m1042: () => 1 }, n1042: 2 }; }
function box1042(): { t: O1042 } { return { t: make1042() }; }
function get1042(): unknown { return box1042().t.in1042.m1042; }
function hit1042(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c1042(): void { say("nested/holder-through-a-record/switch", hit1042((get1042()), (get1042()))); }

interface R1043 { a1043: number; m1043: () => number }
interface O1043 { in1043: R1043; n1043: number }
function make1043(): O1043 { return { in1043: { a1043: 1, m1043: () => 1 }, n1043: 2 }; }
function box1043(): { t: O1043 } { return { t: make1043() }; }
function get1043(): unknown { return box1043().t.in1043.m1043; }
let last1043: unknown;
function seen1043(f: unknown): boolean { const same = f === last1043; last1043 = f; return same; }
function c1043(): void { say("nested/holder-through-a-record/kept-then-compared", (seen1043((get1043())), seen1043((get1043())))); }

function make1044(): Array<() => number> { return [() => 1]; }
class K1044 { #f: unknown; constructor() { this.#f = make1044()[0]; } get(): unknown { return this.#f; } }
function c1044(): void { say("array/private-field/strict-eq", (new K1044().get()) === (new K1044().get())); }

function make1045(): Array<() => number> { return [() => 1]; }
class K1045 { static f: unknown; }
function c1045(): void { say("array/static-field/strict-eq", ((K1045.f = make1045()[0], K1045.f)) === ((K1045.f = make1045()[0], K1045.f))); }

function make1046(): Array<() => number> { return [() => 1]; }
class K1046 { f: unknown = make1046()[0]; }
function c1046(): void { say("array/instance-field/strict-eq", (new K1046().f) === (new K1046().f)); }

function make1047(): Array<() => number> { return [() => 1]; }
class K1047 { s: unknown; set v(x: unknown) { this.s = x; } }
function get1047(): unknown { const k = new K1047(); k.v = make1047()[0]; return k.s; }
function c1047(): void { say("array/setter/strict-eq", (get1047()) === (get1047())); }

function make1048(): Array<() => number> { return [() => 1]; }
class B1048 { get(): unknown { return make1048()[0]; } }
class D1048 extends B1048 { get(): unknown { return super.get(); } }
function c1048(): void { say("array/super-method/strict-eq", (new D1048().get()) === (new D1048().get())); }

function make1049(): Array<() => number> { return [() => 1]; }
class K1049 { constructor(public f: unknown) {} }
function c1049(): void { say("array/constructor-parameter/strict-eq", (new K1049(make1049()[0]).f) === (new K1049(make1049()[0]).f)); }

function make1050(): Array<() => number> { return [() => 1]; }
function tag1050(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c1050(): void { say("array/tagged-template/strict-eq", (tag1050`${make1050()[0]}`) === (tag1050`${make1050()[0]}`)); }

function make1051(): Array<() => number> { return [() => 1]; }
function get1051(x: unknown = make1051()[0]): unknown { return x; }
function c1051(): void { say("array/default-parameter/strict-eq", (get1051()) === (get1051())); }

function make1052(): Array<() => number> { return [() => 1]; }
function get1052({ f = make1052()[0] as unknown }: { f?: unknown } = {}): unknown { return f; }
function c1052(): void { say("array/pattern-default/strict-eq", (get1052()) === (get1052())); }

function make1053(): Array<() => number> { return [() => 1]; }
function get1053(): unknown { const [f] = [make1053()[0]]; return f; }
function c1053(): void { say("array/array-pattern/strict-eq", (get1053()) === (get1053())); }

function make1054(): Array<() => number> { return [() => 1]; }
function get1054(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make1054()[0]; } }; for (const f of it) return f; return 0; }
function c1054(): void { say("array/custom-iterable/strict-eq", (get1054()) === (get1054())); }

function make1055(): Array<() => number> { return [() => 1]; }
function c1055(): void { say("array/map-callback/strict-eq", ([0].map(() => make1055()[0])[0]) === ([0].map(() => make1055()[0])[0])); }

function make1056(): Array<() => number> { return [() => 1]; }
function c1056(): void { say("array/find/strict-eq", ([make1056()[0]].find(() => true)) === ([make1056()[0]].find(() => true))); }

function make1057(): Array<() => number> { return [() => 1]; }
function c1057(): void { say("array/reduce/strict-eq", ([make1057()[0] as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) === ([make1057()[0] as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))); }

function make1058(): Array<() => number> { return [() => 1]; }
function c1058(): void { say("array/filter/strict-eq", ([make1058()[0]].filter(() => true)[0]) === ([make1058()[0]].filter(() => true)[0])); }

function make1059(): Array<() => number> { return [() => 1]; }
function c1059(): void { say("array/flat/strict-eq", ([[make1059()[0]]].flat()[0]) === ([[make1059()[0]]].flat()[0])); }

function make1060(): Array<() => number> { return [() => 1]; }
function c1060(): void { say("array/at/strict-eq", ([make1060()[0]].at(0)) === ([make1060()[0]].at(0))); }

function make1061(): Array<() => number> { return [() => 1]; }
function c1061(): void { say("array/pop/strict-eq", ([make1061()[0]].pop()) === ([make1061()[0]].pop())); }

function make1062(): Array<() => number> { return [() => 1]; }
function c1062(): void { say("array/shift/strict-eq", ([make1062()[0]].shift()) === ([make1062()[0]].shift())); }

function make1063(): Array<() => number> { return [() => 1]; }
function c1063(): void { say("array/slice/strict-eq", ([make1063()[0]].slice()[0]) === ([make1063()[0]].slice()[0])); }

function make1064(): Array<() => number> { return [() => 1]; }
function c1064(): void { say("array/concat/strict-eq", (([] as unknown[]).concat([make1064()[0]])[0]) === (([] as unknown[]).concat([make1064()[0]])[0])); }

function make1065(): Array<() => number> { return [() => 1]; }
function c1065(): void { say("array/spread-array/strict-eq", ([...[make1065()[0]]][0]) === ([...[make1065()[0]]][0])); }

function make1066(): Array<() => number> { return [() => 1]; }
function c1066(): void { say("array/array-from/strict-eq", (Array.from([make1066()[0]])[0]) === (Array.from([make1066()[0]])[0])); }

function make1067(): Array<() => number> { return [() => 1]; }
function c1067(): void { say("array/array-of/strict-eq", (Array.of(make1067()[0])[0]) === (Array.of(make1067()[0])[0])); }

function make1068(): Array<() => number> { return [() => 1]; }
function get1068(): unknown { const xs: unknown[] = []; xs.push(make1068()[0]); return xs[0]; }
function c1068(): void { say("array/push-then-read/strict-eq", (get1068()) === (get1068())); }

function make1069(): Array<() => number> { return [() => 1]; }
function c1069(): void { say("array/set-iteration/strict-eq", ([...new Set([make1069()[0]])][0]) === ([...new Set([make1069()[0]])][0])); }

function make1070(): Array<() => number> { return [() => 1]; }
function c1070(): void { say("array/map-get/strict-eq", (new Map([[1, make1070()[0]]]).get(1)) === (new Map([[1, make1070()[0]]]).get(1))); }

function make1071(): Array<() => number> { return [() => 1]; }
function self1071(this: unknown): unknown { return this; }
function c1071(): void { say("array/bind-this/strict-eq", (self1071.bind(make1071()[0])()) === (self1071.bind(make1071()[0])())); }

function make1072(): Array<() => number> { return [() => 1]; }
function self1072(this: unknown): unknown { return this; }
function c1072(): void { say("array/call-this/strict-eq", (self1072.call(make1072()[0])) === (self1072.call(make1072()[0]))); }

function make1073(): Array<() => number> { return [() => 1]; }
function first1073(x: unknown): unknown { return x; }
function c1073(): void { say("array/apply-arguments/strict-eq", (first1073.apply(null, [make1073()[0]])) === (first1073.apply(null, [make1073()[0]]))); }

function make1074(): Array<() => number> { return [() => 1]; }
function first1074(x: unknown): unknown { return x; }
function c1074(): void { say("array/reflect-apply/strict-eq", (Reflect.apply(first1074, null, [make1074()[0]])) === (Reflect.apply(first1074, null, [make1074()[0]]))); }

function make1075(): Array<() => number> { return [() => 1]; }
function c1075(): void { say("array/logical-or/strict-eq", (((0 as unknown) || make1075()[0])) === (((0 as unknown) || make1075()[0]))); }

function make1076(): Array<() => number> { return [() => 1]; }
let none1076: unknown;
function c1076(): void { say("array/nullish/strict-eq", ((none1076 ?? make1076()[0])) === ((none1076 ?? make1076()[0]))); }

function make1077(): Array<() => number> { return [() => 1]; }
function c1077(): void { say("array/comma/strict-eq", ((out.length, make1077()[0])) === ((out.length, make1077()[0]))); }

function make1078(): Array<() => number> { return [() => 1]; }
function c1078(): void { say("array/computed-member/strict-eq", (({ ["k"]: make1078()[0] })["k"]) === (({ ["k"]: make1078()[0] })["k"])); }

function make1079(): Array<() => number> { return [() => 1]; }
const s1079 = Symbol();
function c1079(): void { say("array/symbol-member/strict-eq", (({ [s1079]: make1079()[0] })[s1079]) === (({ [s1079]: make1079()[0] })[s1079])); }

function make1080(): Array<() => number> { return [() => 1]; }
function c1080(): void { say("array/getter-member/strict-eq", (({ get f(): unknown { return make1080()[0]; } }).f) === (({ get f(): unknown { return make1080()[0]; } }).f)); }

c1021(); c1022(); c1023(); c1024(); c1025(); c1026(); c1027(); c1028(); c1029(); c1030(); c1031(); c1032(); c1033(); c1034(); c1035(); c1036(); c1037(); c1038(); c1039(); c1040(); c1041(); c1042(); c1043(); c1044(); c1045(); c1046(); c1047(); c1048(); c1049(); c1050(); c1051(); c1052(); c1053(); c1054(); c1055(); c1056(); c1057(); c1058(); c1059(); c1060(); c1061(); c1062(); c1063(); c1064(); c1065(); c1066(); c1067(); c1068(); c1069(); c1070(); c1071(); c1072(); c1073(); c1074(); c1075(); c1076(); c1077(); c1078(); c1079(); c1080();
console.log(out.join("\n"));
