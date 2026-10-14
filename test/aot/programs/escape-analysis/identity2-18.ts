// Generated program: object and closure identity stays observable when allocations are removed (second series, part 18).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

function make1081(): Array<() => number> { return [() => 1]; }
function c1081(): void { say("array/proxy-get/strict-eq", (new Proxy({ f: make1081()[0] as unknown }, {}).f) === (new Proxy({ f: make1081()[0] as unknown }, {}).f)); }

function make1082(): Array<() => number> { return [() => 1]; }
function c1082(): void { say("array/prototype-chain/strict-eq", (Object.create({ f: make1082()[0] }).f) === (Object.create({ f: make1082()[0] }).f)); }

function make1083(): Array<() => number> { return [() => 1]; }
function c1083(): void { say("array/weak-ref/strict-eq", (new WeakRef(make1083()[0] as object).deref()) === (new WeakRef(make1083()[0] as object).deref())); }

function make1084(): Array<() => number> { return [() => 1]; }
function get1084(_x: unknown): unknown { return arguments[0]; }
function c1084(): void { say("array/arguments-object/strict-eq", (get1084(make1084()[0])) === (get1084(make1084()[0]))); }

function make1085(): Array<() => number> { return [() => 1]; }
function get1085(n: number): unknown { return n === 0 ? make1085()[0] : get1085(n - 1); }
function c1085(): void { say("array/recursion/strict-eq", (get1085(2)) === (get1085(2))); }

function make1086(): Array<() => number> { return [() => 1]; }
function even1086(n: number): unknown { return n === 0 ? make1086()[0] : odd1086(n - 1); }
function odd1086(n: number): unknown { return even1086(n - 1); }
function c1086(): void { say("array/mutual-recursion/strict-eq", (even1086(2)) === (even1086(2))); }

function make1087(): Array<() => number> { return [() => 1]; }
function again1087(): Array<() => number> { return make1087(); }
function c1087(): void { say("array/maker-forwarded/strict-eq", (again1087()[0]) === (again1087()[0])); }

function make1088(): Array<() => number> { return [() => 1]; }
function again1088(): Array<() => number> { return make1088(); }
function get1088(): unknown { return again1088()[0]; }
function c1088(): void { say("array/maker-forwarded-and-returned/strict-eq", (get1088()) === (get1088())); }

function make1089(): Array<() => number> { return [() => 1]; }
function build1089(f: () => Array<() => number>): Array<() => number> { return f(); }
function c1089(): void { say("array/maker-as-a-callback/strict-eq", (build1089(make1089)[0]) === (build1089(make1089)[0])); }

function make1090(): Array<() => number> { return [() => 1]; }
function build1090(f: () => Array<() => number>): Array<() => number> { return f(); }
function get1090(): unknown { return build1090(make1090)[0]; }
function c1090(): void { say("array/maker-as-a-callback-returned/strict-eq", (get1090()) === (get1090())); }

function make1091(): Array<() => number> { return [() => 1]; }
function box1091(): { t: Array<() => number> } { return { t: make1091() }; }
function get1091(): unknown { return box1091().t[0]; }
function c1091(): void { say("array/holder-through-a-record/strict-eq", (get1091()) === (get1091())); }

function make1092(): Array<() => number> { return [() => 1]; }
function box1092(): Array<Array<() => number>> { return [make1092()]; }
function get1092(): unknown { return box1092()[0][0]; }
function c1092(): void { say("array/holder-through-an-array/strict-eq", (get1092()) === (get1092())); }

function make1093(): Array<() => number> { return [() => 1]; }
function box1093(): () => Array<() => number> { const t = make1093(); return () => t; }
function get1093(): unknown { return box1093()()[0]; }
function c1093(): void { say("array/holder-through-a-closure/strict-eq", (get1093()) === (get1093())); }

function make1094(): Array<() => number> { return [() => 1]; }
function get1094(): unknown { try { return make1094()[0]; } finally { out.length; } }
function c1094(): void { say("array/finally/strict-eq", (get1094()) === (get1094())); }

function make1095(): Array<() => number> { return [() => 1]; }
function get1095(n: number): unknown { switch (n) { case 1: return make1095()[0]; default: return 0; } }
function c1095(): void { say("array/switch-arm/strict-eq", (get1095(1)) === (get1095(1))); }

function make1096(): Array<() => number> { return [() => 1]; }
function c1096(): void { say("array/object-from-entries/strict-eq", (Object.fromEntries([["k", make1096()[0]]]).k) === (Object.fromEntries([["k", make1096()[0]]]).k)); }

function make1097(): Array<() => number> { return [() => 1]; }
function get1097(): unknown { const t = make1097(); const u = { t, n: 1 }; const v = { u }; return v.u.t[0]; }
function c1097(): void { say("array/structured-holder/strict-eq", (get1097()) === (get1097())); }

function make1098(): Array<() => number> { return [() => 1]; }
function box1098(): { t: Array<() => number> } { return { t: make1098() }; }
function get1098(): unknown { return box1098().t[0]; }
function c1098(): void { say("array/holder-through-a-record/strict-ne", (get1098()) !== (get1098())); }

function make1099(): Array<() => number> { return [() => 1]; }
function box1099(): { t: Array<() => number> } { return { t: make1099() }; }
function get1099(): unknown { return box1099().t[0]; }
function c1099(): void { say("array/holder-through-a-record/loose-eq", (get1099()) == (get1099())); }

function make1100(): Array<() => number> { return [() => 1]; }
function box1100(): { t: Array<() => number> } { return { t: make1100() }; }
function get1100(): unknown { return box1100().t[0]; }
function c1100(): void { say("array/holder-through-a-record/object-is", Object.is((get1100()), (get1100()))); }

function make1101(): Array<() => number> { return [() => 1]; }
function box1101(): { t: Array<() => number> } { return { t: make1101() }; }
function get1101(): unknown { return box1101().t[0]; }
function c1101(): void { say("array/holder-through-a-record/set", new Set([(get1101()), (get1101())]).size); }

function make1102(): Array<() => number> { return [() => 1]; }
function box1102(): { t: Array<() => number> } { return { t: make1102() }; }
function get1102(): unknown { return box1102().t[0]; }
function c1102(): void { say("array/holder-through-a-record/map-key", new Map([[(get1102()), 1], [(get1102()), 2]]).size); }

function make1103(): Array<() => number> { return [() => 1]; }
function box1103(): { t: Array<() => number> } { return { t: make1103() }; }
function get1103(): unknown { return box1103().t[0]; }
function c1103(): void { say("array/holder-through-a-record/includes", [(get1103())].includes((get1103()))); }

function make1104(): Array<() => number> { return [() => 1]; }
function box1104(): { t: Array<() => number> } { return { t: make1104() }; }
function get1104(): unknown { return box1104().t[0]; }
function c1104(): void { say("array/holder-through-a-record/index-of", [(get1104())].indexOf((get1104()))); }

function make1105(): Array<() => number> { return [() => 1]; }
function box1105(): { t: Array<() => number> } { return { t: make1105() }; }
function get1105(): unknown { return box1105().t[0]; }
const ws1105 = new WeakSet<object>();
function c1105(): void { say("array/holder-through-a-record/weak-set", (ws1105.add((get1105()) as object), ws1105.has((get1105()) as object))); }

function make1106(): Array<() => number> { return [() => 1]; }
function box1106(): { t: Array<() => number> } { return { t: make1106() }; }
function get1106(): unknown { return box1106().t[0]; }
const wm1106 = new WeakMap<object, number>();
function c1106(): void { say("array/holder-through-a-record/weak-map", (wm1106.set((get1106()) as object, 1), wm1106.has((get1106()) as object))); }

function make1107(): Array<() => number> { return [() => 1]; }
function box1107(): { t: Array<() => number> } { return { t: make1107() }; }
function get1107(): unknown { return box1107().t[0]; }
function c1107(): void { say("array/holder-through-a-record/written", ((((get1107())) as any).tag = 1, (((get1107())) as any).tag)); }

function make1108(): Array<() => number> { return [() => 1]; }
function box1108(): { t: Array<() => number> } { return { t: make1108() }; }
function get1108(): unknown { return box1108().t[0]; }
function c1108(): void { say("array/holder-through-a-record/defined", (Object.defineProperty((get1108()) as object, "t", { value: 1 }), "t" in ((get1108()) as object))); }

function make1109(): Array<() => number> { return [() => 1]; }
function box1109(): { t: Array<() => number> } { return { t: make1109() }; }
function get1109(): unknown { return box1109().t[0]; }
function c1109(): void { say("array/holder-through-a-record/frozen", (Object.freeze((get1109())), Object.isFrozen((get1109())))); }

function make1110(): Array<() => number> { return [() => 1]; }
function box1110(): { t: Array<() => number> } { return { t: make1110() }; }
function get1110(): unknown { return box1110().t[0]; }
function c1110(): void { say("array/holder-through-a-record/prototype-set", (Object.setPrototypeOf((get1110()) as object, null), Object.getPrototypeOf((get1110())) === null)); }

function make1111(): Array<() => number> { return [() => 1]; }
function box1111(): { t: Array<() => number> } { return { t: make1111() }; }
function get1111(): unknown { return box1111().t[0]; }
function c1111(): void { say("array/holder-through-a-record/deleted", (delete (((get1111())) as any).length, Object.hasOwn((get1111()) as object, "length"))); }

function make1112(): Array<() => number> { return [() => 1]; }
function box1112(): { t: Array<() => number> } { return { t: make1112() }; }
function get1112(): unknown { return box1112().t[0]; }
function same1112(a: unknown, b: unknown): boolean { return a === b; }
function c1112(): void { say("array/holder-through-a-record/in-a-callee", same1112((get1112()), (get1112()))); }

function make1113(): Array<() => number> { return [() => 1]; }
function box1113(): { t: Array<() => number> } { return { t: make1113() }; }
function get1113(): unknown { return box1113().t[0]; }
function hit1113(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c1113(): void { say("array/holder-through-a-record/switch", hit1113((get1113()), (get1113()))); }

function make1114(): Array<() => number> { return [() => 1]; }
function box1114(): { t: Array<() => number> } { return { t: make1114() }; }
function get1114(): unknown { return box1114().t[0]; }
let last1114: unknown;
function seen1114(f: unknown): boolean { const same = f === last1114; last1114 = f; return same; }
function c1114(): void { say("array/holder-through-a-record/kept-then-compared", (seen1114((get1114())), seen1114((get1114())))); }

interface R1115 { a1115: number; m1115: () => number }
function make1115(): R1115[] { return [{ a1115: 1, m1115: () => 1 }]; }
class K1115 { #f: unknown; constructor() { this.#f = make1115()[0].m1115; } get(): unknown { return this.#f; } }
function c1115(): void { say("records/private-field/strict-eq", (new K1115().get()) === (new K1115().get())); }

interface R1116 { a1116: number; m1116: () => number }
function make1116(): R1116[] { return [{ a1116: 1, m1116: () => 1 }]; }
class K1116 { static f: unknown; }
function c1116(): void { say("records/static-field/strict-eq", ((K1116.f = make1116()[0].m1116, K1116.f)) === ((K1116.f = make1116()[0].m1116, K1116.f))); }

interface R1117 { a1117: number; m1117: () => number }
function make1117(): R1117[] { return [{ a1117: 1, m1117: () => 1 }]; }
class K1117 { f: unknown = make1117()[0].m1117; }
function c1117(): void { say("records/instance-field/strict-eq", (new K1117().f) === (new K1117().f)); }

interface R1118 { a1118: number; m1118: () => number }
function make1118(): R1118[] { return [{ a1118: 1, m1118: () => 1 }]; }
class K1118 { s: unknown; set v(x: unknown) { this.s = x; } }
function get1118(): unknown { const k = new K1118(); k.v = make1118()[0].m1118; return k.s; }
function c1118(): void { say("records/setter/strict-eq", (get1118()) === (get1118())); }

interface R1119 { a1119: number; m1119: () => number }
function make1119(): R1119[] { return [{ a1119: 1, m1119: () => 1 }]; }
class B1119 { get(): unknown { return make1119()[0].m1119; } }
class D1119 extends B1119 { get(): unknown { return super.get(); } }
function c1119(): void { say("records/super-method/strict-eq", (new D1119().get()) === (new D1119().get())); }

interface R1120 { a1120: number; m1120: () => number }
function make1120(): R1120[] { return [{ a1120: 1, m1120: () => 1 }]; }
class K1120 { constructor(public f: unknown) {} }
function c1120(): void { say("records/constructor-parameter/strict-eq", (new K1120(make1120()[0].m1120).f) === (new K1120(make1120()[0].m1120).f)); }

interface R1121 { a1121: number; m1121: () => number }
function make1121(): R1121[] { return [{ a1121: 1, m1121: () => 1 }]; }
function tag1121(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c1121(): void { say("records/tagged-template/strict-eq", (tag1121`${make1121()[0].m1121}`) === (tag1121`${make1121()[0].m1121}`)); }

interface R1122 { a1122: number; m1122: () => number }
function make1122(): R1122[] { return [{ a1122: 1, m1122: () => 1 }]; }
function get1122(x: unknown = make1122()[0].m1122): unknown { return x; }
function c1122(): void { say("records/default-parameter/strict-eq", (get1122()) === (get1122())); }

interface R1123 { a1123: number; m1123: () => number }
function make1123(): R1123[] { return [{ a1123: 1, m1123: () => 1 }]; }
function get1123({ f = make1123()[0].m1123 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c1123(): void { say("records/pattern-default/strict-eq", (get1123()) === (get1123())); }

interface R1124 { a1124: number; m1124: () => number }
function make1124(): R1124[] { return [{ a1124: 1, m1124: () => 1 }]; }
function get1124(): unknown { const [f] = [make1124()[0].m1124]; return f; }
function c1124(): void { say("records/array-pattern/strict-eq", (get1124()) === (get1124())); }

interface R1125 { a1125: number; m1125: () => number }
function make1125(): R1125[] { return [{ a1125: 1, m1125: () => 1 }]; }
function get1125(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make1125()[0].m1125; } }; for (const f of it) return f; return 0; }
function c1125(): void { say("records/custom-iterable/strict-eq", (get1125()) === (get1125())); }

interface R1126 { a1126: number; m1126: () => number }
function make1126(): R1126[] { return [{ a1126: 1, m1126: () => 1 }]; }
function c1126(): void { say("records/map-callback/strict-eq", ([0].map(() => make1126()[0].m1126)[0]) === ([0].map(() => make1126()[0].m1126)[0])); }

interface R1127 { a1127: number; m1127: () => number }
function make1127(): R1127[] { return [{ a1127: 1, m1127: () => 1 }]; }
function c1127(): void { say("records/find/strict-eq", ([make1127()[0].m1127].find(() => true)) === ([make1127()[0].m1127].find(() => true))); }

interface R1128 { a1128: number; m1128: () => number }
function make1128(): R1128[] { return [{ a1128: 1, m1128: () => 1 }]; }
function c1128(): void { say("records/reduce/strict-eq", ([make1128()[0].m1128 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) === ([make1128()[0].m1128 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))); }

interface R1129 { a1129: number; m1129: () => number }
function make1129(): R1129[] { return [{ a1129: 1, m1129: () => 1 }]; }
function c1129(): void { say("records/filter/strict-eq", ([make1129()[0].m1129].filter(() => true)[0]) === ([make1129()[0].m1129].filter(() => true)[0])); }

interface R1130 { a1130: number; m1130: () => number }
function make1130(): R1130[] { return [{ a1130: 1, m1130: () => 1 }]; }
function c1130(): void { say("records/flat/strict-eq", ([[make1130()[0].m1130]].flat()[0]) === ([[make1130()[0].m1130]].flat()[0])); }

interface R1131 { a1131: number; m1131: () => number }
function make1131(): R1131[] { return [{ a1131: 1, m1131: () => 1 }]; }
function c1131(): void { say("records/at/strict-eq", ([make1131()[0].m1131].at(0)) === ([make1131()[0].m1131].at(0))); }

interface R1132 { a1132: number; m1132: () => number }
function make1132(): R1132[] { return [{ a1132: 1, m1132: () => 1 }]; }
function c1132(): void { say("records/pop/strict-eq", ([make1132()[0].m1132].pop()) === ([make1132()[0].m1132].pop())); }

interface R1133 { a1133: number; m1133: () => number }
function make1133(): R1133[] { return [{ a1133: 1, m1133: () => 1 }]; }
function c1133(): void { say("records/shift/strict-eq", ([make1133()[0].m1133].shift()) === ([make1133()[0].m1133].shift())); }

interface R1134 { a1134: number; m1134: () => number }
function make1134(): R1134[] { return [{ a1134: 1, m1134: () => 1 }]; }
function c1134(): void { say("records/slice/strict-eq", ([make1134()[0].m1134].slice()[0]) === ([make1134()[0].m1134].slice()[0])); }

interface R1135 { a1135: number; m1135: () => number }
function make1135(): R1135[] { return [{ a1135: 1, m1135: () => 1 }]; }
function c1135(): void { say("records/concat/strict-eq", (([] as unknown[]).concat([make1135()[0].m1135])[0]) === (([] as unknown[]).concat([make1135()[0].m1135])[0])); }

interface R1136 { a1136: number; m1136: () => number }
function make1136(): R1136[] { return [{ a1136: 1, m1136: () => 1 }]; }
function c1136(): void { say("records/spread-array/strict-eq", ([...[make1136()[0].m1136]][0]) === ([...[make1136()[0].m1136]][0])); }

interface R1137 { a1137: number; m1137: () => number }
function make1137(): R1137[] { return [{ a1137: 1, m1137: () => 1 }]; }
function c1137(): void { say("records/array-from/strict-eq", (Array.from([make1137()[0].m1137])[0]) === (Array.from([make1137()[0].m1137])[0])); }

interface R1138 { a1138: number; m1138: () => number }
function make1138(): R1138[] { return [{ a1138: 1, m1138: () => 1 }]; }
function c1138(): void { say("records/array-of/strict-eq", (Array.of(make1138()[0].m1138)[0]) === (Array.of(make1138()[0].m1138)[0])); }

interface R1139 { a1139: number; m1139: () => number }
function make1139(): R1139[] { return [{ a1139: 1, m1139: () => 1 }]; }
function get1139(): unknown { const xs: unknown[] = []; xs.push(make1139()[0].m1139); return xs[0]; }
function c1139(): void { say("records/push-then-read/strict-eq", (get1139()) === (get1139())); }

interface R1140 { a1140: number; m1140: () => number }
function make1140(): R1140[] { return [{ a1140: 1, m1140: () => 1 }]; }
function c1140(): void { say("records/set-iteration/strict-eq", ([...new Set([make1140()[0].m1140])][0]) === ([...new Set([make1140()[0].m1140])][0])); }

c1081(); c1082(); c1083(); c1084(); c1085(); c1086(); c1087(); c1088(); c1089(); c1090(); c1091(); c1092(); c1093(); c1094(); c1095(); c1096(); c1097(); c1098(); c1099(); c1100(); c1101(); c1102(); c1103(); c1104(); c1105(); c1106(); c1107(); c1108(); c1109(); c1110(); c1111(); c1112(); c1113(); c1114(); c1115(); c1116(); c1117(); c1118(); c1119(); c1120(); c1121(); c1122(); c1123(); c1124(); c1125(); c1126(); c1127(); c1128(); c1129(); c1130(); c1131(); c1132(); c1133(); c1134(); c1135(); c1136(); c1137(); c1138(); c1139(); c1140();
console.log(out.join("\n"));
