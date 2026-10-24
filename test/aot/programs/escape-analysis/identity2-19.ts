// Generated program: object and closure identity stays observable when allocations are removed (second series, part 19).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R1141 { a1141: number; m1141: () => number }
function make1141(): R1141[] { return [{ a1141: 1, m1141: () => 1 }]; }
function c1141(): void { say("records/map-get/strict-eq", (new Map([[1, make1141()[0].m1141]]).get(1)) === (new Map([[1, make1141()[0].m1141]]).get(1))); }

interface R1142 { a1142: number; m1142: () => number }
function make1142(): R1142[] { return [{ a1142: 1, m1142: () => 1 }]; }
function self1142(this: unknown): unknown { return this; }
function c1142(): void { say("records/bind-this/strict-eq", (self1142.bind(make1142()[0].m1142)()) === (self1142.bind(make1142()[0].m1142)())); }

interface R1143 { a1143: number; m1143: () => number }
function make1143(): R1143[] { return [{ a1143: 1, m1143: () => 1 }]; }
function self1143(this: unknown): unknown { return this; }
function c1143(): void { say("records/call-this/strict-eq", (self1143.call(make1143()[0].m1143)) === (self1143.call(make1143()[0].m1143))); }

interface R1144 { a1144: number; m1144: () => number }
function make1144(): R1144[] { return [{ a1144: 1, m1144: () => 1 }]; }
function first1144(x: unknown): unknown { return x; }
function c1144(): void { say("records/apply-arguments/strict-eq", (first1144.apply(null, [make1144()[0].m1144])) === (first1144.apply(null, [make1144()[0].m1144]))); }

interface R1145 { a1145: number; m1145: () => number }
function make1145(): R1145[] { return [{ a1145: 1, m1145: () => 1 }]; }
function first1145(x: unknown): unknown { return x; }
function c1145(): void { say("records/reflect-apply/strict-eq", (Reflect.apply(first1145, null, [make1145()[0].m1145])) === (Reflect.apply(first1145, null, [make1145()[0].m1145]))); }

interface R1146 { a1146: number; m1146: () => number }
function make1146(): R1146[] { return [{ a1146: 1, m1146: () => 1 }]; }
function c1146(): void { say("records/logical-or/strict-eq", (((0 as unknown) || make1146()[0].m1146)) === (((0 as unknown) || make1146()[0].m1146))); }

interface R1147 { a1147: number; m1147: () => number }
function make1147(): R1147[] { return [{ a1147: 1, m1147: () => 1 }]; }
let none1147: unknown;
function c1147(): void { say("records/nullish/strict-eq", ((none1147 ?? make1147()[0].m1147)) === ((none1147 ?? make1147()[0].m1147))); }

interface R1148 { a1148: number; m1148: () => number }
function make1148(): R1148[] { return [{ a1148: 1, m1148: () => 1 }]; }
function c1148(): void { say("records/comma/strict-eq", ((out.length, make1148()[0].m1148)) === ((out.length, make1148()[0].m1148))); }

interface R1149 { a1149: number; m1149: () => number }
function make1149(): R1149[] { return [{ a1149: 1, m1149: () => 1 }]; }
function c1149(): void { say("records/computed-member/strict-eq", (({ ["k"]: make1149()[0].m1149 })["k"]) === (({ ["k"]: make1149()[0].m1149 })["k"])); }

interface R1150 { a1150: number; m1150: () => number }
function make1150(): R1150[] { return [{ a1150: 1, m1150: () => 1 }]; }
const s1150 = Symbol();
function c1150(): void { say("records/symbol-member/strict-eq", (({ [s1150]: make1150()[0].m1150 })[s1150]) === (({ [s1150]: make1150()[0].m1150 })[s1150])); }

interface R1151 { a1151: number; m1151: () => number }
function make1151(): R1151[] { return [{ a1151: 1, m1151: () => 1 }]; }
function c1151(): void { say("records/getter-member/strict-eq", (({ get f(): unknown { return make1151()[0].m1151; } }).f) === (({ get f(): unknown { return make1151()[0].m1151; } }).f)); }

interface R1152 { a1152: number; m1152: () => number }
function make1152(): R1152[] { return [{ a1152: 1, m1152: () => 1 }]; }
function c1152(): void { say("records/proxy-get/strict-eq", (new Proxy({ f: make1152()[0].m1152 as unknown }, {}).f) === (new Proxy({ f: make1152()[0].m1152 as unknown }, {}).f)); }

interface R1153 { a1153: number; m1153: () => number }
function make1153(): R1153[] { return [{ a1153: 1, m1153: () => 1 }]; }
function c1153(): void { say("records/prototype-chain/strict-eq", (Object.create({ f: make1153()[0].m1153 }).f) === (Object.create({ f: make1153()[0].m1153 }).f)); }

interface R1154 { a1154: number; m1154: () => number }
function make1154(): R1154[] { return [{ a1154: 1, m1154: () => 1 }]; }
function c1154(): void { say("records/weak-ref/strict-eq", (new WeakRef(make1154()[0].m1154 as object).deref()) === (new WeakRef(make1154()[0].m1154 as object).deref())); }

interface R1155 { a1155: number; m1155: () => number }
function make1155(): R1155[] { return [{ a1155: 1, m1155: () => 1 }]; }
function get1155(_x: unknown): unknown { return arguments[0]; }
function c1155(): void { say("records/arguments-object/strict-eq", (get1155(make1155()[0].m1155)) === (get1155(make1155()[0].m1155))); }

interface R1156 { a1156: number; m1156: () => number }
function make1156(): R1156[] { return [{ a1156: 1, m1156: () => 1 }]; }
function get1156(n: number): unknown { return n === 0 ? make1156()[0].m1156 : get1156(n - 1); }
function c1156(): void { say("records/recursion/strict-eq", (get1156(2)) === (get1156(2))); }

interface R1157 { a1157: number; m1157: () => number }
function make1157(): R1157[] { return [{ a1157: 1, m1157: () => 1 }]; }
function even1157(n: number): unknown { return n === 0 ? make1157()[0].m1157 : odd1157(n - 1); }
function odd1157(n: number): unknown { return even1157(n - 1); }
function c1157(): void { say("records/mutual-recursion/strict-eq", (even1157(2)) === (even1157(2))); }

interface R1158 { a1158: number; m1158: () => number }
function make1158(): R1158[] { return [{ a1158: 1, m1158: () => 1 }]; }
function again1158(): R1158[] { return make1158(); }
function c1158(): void { say("records/maker-forwarded/strict-eq", (again1158()[0].m1158) === (again1158()[0].m1158)); }

interface R1159 { a1159: number; m1159: () => number }
function make1159(): R1159[] { return [{ a1159: 1, m1159: () => 1 }]; }
function again1159(): R1159[] { return make1159(); }
function get1159(): unknown { return again1159()[0].m1159; }
function c1159(): void { say("records/maker-forwarded-and-returned/strict-eq", (get1159()) === (get1159())); }

interface R1160 { a1160: number; m1160: () => number }
function make1160(): R1160[] { return [{ a1160: 1, m1160: () => 1 }]; }
function build1160(f: () => R1160[]): R1160[] { return f(); }
function c1160(): void { say("records/maker-as-a-callback/strict-eq", (build1160(make1160)[0].m1160) === (build1160(make1160)[0].m1160)); }

interface R1161 { a1161: number; m1161: () => number }
function make1161(): R1161[] { return [{ a1161: 1, m1161: () => 1 }]; }
function build1161(f: () => R1161[]): R1161[] { return f(); }
function get1161(): unknown { return build1161(make1161)[0].m1161; }
function c1161(): void { say("records/maker-as-a-callback-returned/strict-eq", (get1161()) === (get1161())); }

interface R1162 { a1162: number; m1162: () => number }
function make1162(): R1162[] { return [{ a1162: 1, m1162: () => 1 }]; }
function box1162(): { t: R1162[] } { return { t: make1162() }; }
function get1162(): unknown { return box1162().t[0].m1162; }
function c1162(): void { say("records/holder-through-a-record/strict-eq", (get1162()) === (get1162())); }

interface R1163 { a1163: number; m1163: () => number }
function make1163(): R1163[] { return [{ a1163: 1, m1163: () => 1 }]; }
function box1163(): Array<R1163[]> { return [make1163()]; }
function get1163(): unknown { return box1163()[0][0].m1163; }
function c1163(): void { say("records/holder-through-an-array/strict-eq", (get1163()) === (get1163())); }

interface R1164 { a1164: number; m1164: () => number }
function make1164(): R1164[] { return [{ a1164: 1, m1164: () => 1 }]; }
function box1164(): () => R1164[] { const t = make1164(); return () => t; }
function get1164(): unknown { return box1164()()[0].m1164; }
function c1164(): void { say("records/holder-through-a-closure/strict-eq", (get1164()) === (get1164())); }

interface R1165 { a1165: number; m1165: () => number }
function make1165(): R1165[] { return [{ a1165: 1, m1165: () => 1 }]; }
function get1165(): unknown { try { return make1165()[0].m1165; } finally { out.length; } }
function c1165(): void { say("records/finally/strict-eq", (get1165()) === (get1165())); }

interface R1166 { a1166: number; m1166: () => number }
function make1166(): R1166[] { return [{ a1166: 1, m1166: () => 1 }]; }
function get1166(n: number): unknown { switch (n) { case 1: return make1166()[0].m1166; default: return 0; } }
function c1166(): void { say("records/switch-arm/strict-eq", (get1166(1)) === (get1166(1))); }

interface R1167 { a1167: number; m1167: () => number }
function make1167(): R1167[] { return [{ a1167: 1, m1167: () => 1 }]; }
function c1167(): void { say("records/object-from-entries/strict-eq", (Object.fromEntries([["k", make1167()[0].m1167]]).k) === (Object.fromEntries([["k", make1167()[0].m1167]]).k)); }

interface R1168 { a1168: number; m1168: () => number }
function make1168(): R1168[] { return [{ a1168: 1, m1168: () => 1 }]; }
function get1168(): unknown { const t = make1168(); const u = { t, n: 1 }; const v = { u }; return v.u.t[0].m1168; }
function c1168(): void { say("records/structured-holder/strict-eq", (get1168()) === (get1168())); }

interface R1169 { a1169: number; m1169: () => number }
function make1169(): R1169[] { return [{ a1169: 1, m1169: () => 1 }]; }
function box1169(): { t: R1169[] } { return { t: make1169() }; }
function get1169(): unknown { return box1169().t[0].m1169; }
function c1169(): void { say("records/holder-through-a-record/strict-ne", (get1169()) !== (get1169())); }

interface R1170 { a1170: number; m1170: () => number }
function make1170(): R1170[] { return [{ a1170: 1, m1170: () => 1 }]; }
function box1170(): { t: R1170[] } { return { t: make1170() }; }
function get1170(): unknown { return box1170().t[0].m1170; }
function c1170(): void { say("records/holder-through-a-record/loose-eq", (get1170()) == (get1170())); }

interface R1171 { a1171: number; m1171: () => number }
function make1171(): R1171[] { return [{ a1171: 1, m1171: () => 1 }]; }
function box1171(): { t: R1171[] } { return { t: make1171() }; }
function get1171(): unknown { return box1171().t[0].m1171; }
function c1171(): void { say("records/holder-through-a-record/object-is", Object.is((get1171()), (get1171()))); }

interface R1172 { a1172: number; m1172: () => number }
function make1172(): R1172[] { return [{ a1172: 1, m1172: () => 1 }]; }
function box1172(): { t: R1172[] } { return { t: make1172() }; }
function get1172(): unknown { return box1172().t[0].m1172; }
function c1172(): void { say("records/holder-through-a-record/set", new Set([(get1172()), (get1172())]).size); }

interface R1173 { a1173: number; m1173: () => number }
function make1173(): R1173[] { return [{ a1173: 1, m1173: () => 1 }]; }
function box1173(): { t: R1173[] } { return { t: make1173() }; }
function get1173(): unknown { return box1173().t[0].m1173; }
function c1173(): void { say("records/holder-through-a-record/map-key", new Map([[(get1173()), 1], [(get1173()), 2]]).size); }

interface R1174 { a1174: number; m1174: () => number }
function make1174(): R1174[] { return [{ a1174: 1, m1174: () => 1 }]; }
function box1174(): { t: R1174[] } { return { t: make1174() }; }
function get1174(): unknown { return box1174().t[0].m1174; }
function c1174(): void { say("records/holder-through-a-record/includes", [(get1174())].includes((get1174()))); }

interface R1175 { a1175: number; m1175: () => number }
function make1175(): R1175[] { return [{ a1175: 1, m1175: () => 1 }]; }
function box1175(): { t: R1175[] } { return { t: make1175() }; }
function get1175(): unknown { return box1175().t[0].m1175; }
function c1175(): void { say("records/holder-through-a-record/index-of", [(get1175())].indexOf((get1175()))); }

interface R1176 { a1176: number; m1176: () => number }
function make1176(): R1176[] { return [{ a1176: 1, m1176: () => 1 }]; }
function box1176(): { t: R1176[] } { return { t: make1176() }; }
function get1176(): unknown { return box1176().t[0].m1176; }
const ws1176 = new WeakSet<object>();
function c1176(): void { say("records/holder-through-a-record/weak-set", (ws1176.add((get1176()) as object), ws1176.has((get1176()) as object))); }

interface R1177 { a1177: number; m1177: () => number }
function make1177(): R1177[] { return [{ a1177: 1, m1177: () => 1 }]; }
function box1177(): { t: R1177[] } { return { t: make1177() }; }
function get1177(): unknown { return box1177().t[0].m1177; }
const wm1177 = new WeakMap<object, number>();
function c1177(): void { say("records/holder-through-a-record/weak-map", (wm1177.set((get1177()) as object, 1), wm1177.has((get1177()) as object))); }

interface R1178 { a1178: number; m1178: () => number }
function make1178(): R1178[] { return [{ a1178: 1, m1178: () => 1 }]; }
function box1178(): { t: R1178[] } { return { t: make1178() }; }
function get1178(): unknown { return box1178().t[0].m1178; }
function c1178(): void { say("records/holder-through-a-record/written", ((((get1178())) as any).tag = 1, (((get1178())) as any).tag)); }

interface R1179 { a1179: number; m1179: () => number }
function make1179(): R1179[] { return [{ a1179: 1, m1179: () => 1 }]; }
function box1179(): { t: R1179[] } { return { t: make1179() }; }
function get1179(): unknown { return box1179().t[0].m1179; }
function c1179(): void { say("records/holder-through-a-record/defined", (Object.defineProperty((get1179()) as object, "t", { value: 1 }), "t" in ((get1179()) as object))); }

interface R1180 { a1180: number; m1180: () => number }
function make1180(): R1180[] { return [{ a1180: 1, m1180: () => 1 }]; }
function box1180(): { t: R1180[] } { return { t: make1180() }; }
function get1180(): unknown { return box1180().t[0].m1180; }
function c1180(): void { say("records/holder-through-a-record/frozen", (Object.freeze((get1180())), Object.isFrozen((get1180())))); }

interface R1181 { a1181: number; m1181: () => number }
function make1181(): R1181[] { return [{ a1181: 1, m1181: () => 1 }]; }
function box1181(): { t: R1181[] } { return { t: make1181() }; }
function get1181(): unknown { return box1181().t[0].m1181; }
function c1181(): void { say("records/holder-through-a-record/prototype-set", (Object.setPrototypeOf((get1181()) as object, null), Object.getPrototypeOf((get1181())) === null)); }

interface R1182 { a1182: number; m1182: () => number }
function make1182(): R1182[] { return [{ a1182: 1, m1182: () => 1 }]; }
function box1182(): { t: R1182[] } { return { t: make1182() }; }
function get1182(): unknown { return box1182().t[0].m1182; }
function c1182(): void { say("records/holder-through-a-record/deleted", (delete (((get1182())) as any).length, Object.hasOwn((get1182()) as object, "length"))); }

interface R1183 { a1183: number; m1183: () => number }
function make1183(): R1183[] { return [{ a1183: 1, m1183: () => 1 }]; }
function box1183(): { t: R1183[] } { return { t: make1183() }; }
function get1183(): unknown { return box1183().t[0].m1183; }
function same1183(a: unknown, b: unknown): boolean { return a === b; }
function c1183(): void { say("records/holder-through-a-record/in-a-callee", same1183((get1183()), (get1183()))); }

interface R1184 { a1184: number; m1184: () => number }
function make1184(): R1184[] { return [{ a1184: 1, m1184: () => 1 }]; }
function box1184(): { t: R1184[] } { return { t: make1184() }; }
function get1184(): unknown { return box1184().t[0].m1184; }
function hit1184(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c1184(): void { say("records/holder-through-a-record/switch", hit1184((get1184()), (get1184()))); }

interface R1185 { a1185: number; m1185: () => number }
function make1185(): R1185[] { return [{ a1185: 1, m1185: () => 1 }]; }
function box1185(): { t: R1185[] } { return { t: make1185() }; }
function get1185(): unknown { return box1185().t[0].m1185; }
let last1185: unknown;
function seen1185(f: unknown): boolean { const same = f === last1185; last1185 = f; return same; }
function c1185(): void { say("records/holder-through-a-record/kept-then-compared", (seen1185((get1185())), seen1185((get1185())))); }

function make1186(): () => number { return () => 1; }
class K1186 { #f: unknown; constructor() { this.#f = make1186(); } get(): unknown { return this.#f; } }
function c1186(): void { say("bare/private-field/strict-eq", (new K1186().get()) === (new K1186().get())); }

function make1187(): () => number { return () => 1; }
class K1187 { static f: unknown; }
function c1187(): void { say("bare/static-field/strict-eq", ((K1187.f = make1187(), K1187.f)) === ((K1187.f = make1187(), K1187.f))); }

function make1188(): () => number { return () => 1; }
class K1188 { f: unknown = make1188(); }
function c1188(): void { say("bare/instance-field/strict-eq", (new K1188().f) === (new K1188().f)); }

function make1189(): () => number { return () => 1; }
class K1189 { s: unknown; set v(x: unknown) { this.s = x; } }
function get1189(): unknown { const k = new K1189(); k.v = make1189(); return k.s; }
function c1189(): void { say("bare/setter/strict-eq", (get1189()) === (get1189())); }

function make1190(): () => number { return () => 1; }
class B1190 { get(): unknown { return make1190(); } }
class D1190 extends B1190 { get(): unknown { return super.get(); } }
function c1190(): void { say("bare/super-method/strict-eq", (new D1190().get()) === (new D1190().get())); }

function make1191(): () => number { return () => 1; }
class K1191 { constructor(public f: unknown) {} }
function c1191(): void { say("bare/constructor-parameter/strict-eq", (new K1191(make1191()).f) === (new K1191(make1191()).f)); }

function make1192(): () => number { return () => 1; }
function tag1192(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c1192(): void { say("bare/tagged-template/strict-eq", (tag1192`${make1192()}`) === (tag1192`${make1192()}`)); }

function make1193(): () => number { return () => 1; }
function get1193(x: unknown = make1193()): unknown { return x; }
function c1193(): void { say("bare/default-parameter/strict-eq", (get1193()) === (get1193())); }

function make1194(): () => number { return () => 1; }
function get1194({ f = make1194() as unknown }: { f?: unknown } = {}): unknown { return f; }
function c1194(): void { say("bare/pattern-default/strict-eq", (get1194()) === (get1194())); }

function make1195(): () => number { return () => 1; }
function get1195(): unknown { const [f] = [make1195()]; return f; }
function c1195(): void { say("bare/array-pattern/strict-eq", (get1195()) === (get1195())); }

function make1196(): () => number { return () => 1; }
function get1196(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make1196(); } }; for (const f of it) return f; return 0; }
function c1196(): void { say("bare/custom-iterable/strict-eq", (get1196()) === (get1196())); }

function make1197(): () => number { return () => 1; }
function c1197(): void { say("bare/map-callback/strict-eq", ([0].map(() => make1197())[0]) === ([0].map(() => make1197())[0])); }

function make1198(): () => number { return () => 1; }
function c1198(): void { say("bare/find/strict-eq", ([make1198()].find(() => true)) === ([make1198()].find(() => true))); }

function make1199(): () => number { return () => 1; }
function c1199(): void { say("bare/reduce/strict-eq", ([make1199() as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) === ([make1199() as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))); }

function make1200(): () => number { return () => 1; }
function c1200(): void { say("bare/filter/strict-eq", ([make1200()].filter(() => true)[0]) === ([make1200()].filter(() => true)[0])); }

c1141(); c1142(); c1143(); c1144(); c1145(); c1146(); c1147(); c1148(); c1149(); c1150(); c1151(); c1152(); c1153(); c1154(); c1155(); c1156(); c1157(); c1158(); c1159(); c1160(); c1161(); c1162(); c1163(); c1164(); c1165(); c1166(); c1167(); c1168(); c1169(); c1170(); c1171(); c1172(); c1173(); c1174(); c1175(); c1176(); c1177(); c1178(); c1179(); c1180(); c1181(); c1182(); c1183(); c1184(); c1185(); c1186(); c1187(); c1188(); c1189(); c1190(); c1191(); c1192(); c1193(); c1194(); c1195(); c1196(); c1197(); c1198(); c1199(); c1200();
console.log(out.join("\n"));
