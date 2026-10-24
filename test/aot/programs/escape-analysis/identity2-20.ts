// Generated program: object and closure identity stays observable when allocations are removed (second series, part 20).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

function make1201(): () => number { return () => 1; }
function c1201(): void { say("bare/flat/strict-eq", ([[make1201()]].flat()[0]) === ([[make1201()]].flat()[0])); }

function make1202(): () => number { return () => 1; }
function c1202(): void { say("bare/at/strict-eq", ([make1202()].at(0)) === ([make1202()].at(0))); }

function make1203(): () => number { return () => 1; }
function c1203(): void { say("bare/pop/strict-eq", ([make1203()].pop()) === ([make1203()].pop())); }

function make1204(): () => number { return () => 1; }
function c1204(): void { say("bare/shift/strict-eq", ([make1204()].shift()) === ([make1204()].shift())); }

function make1205(): () => number { return () => 1; }
function c1205(): void { say("bare/slice/strict-eq", ([make1205()].slice()[0]) === ([make1205()].slice()[0])); }

function make1206(): () => number { return () => 1; }
function c1206(): void { say("bare/concat/strict-eq", (([] as unknown[]).concat([make1206()])[0]) === (([] as unknown[]).concat([make1206()])[0])); }

function make1207(): () => number { return () => 1; }
function c1207(): void { say("bare/spread-array/strict-eq", ([...[make1207()]][0]) === ([...[make1207()]][0])); }

function make1208(): () => number { return () => 1; }
function c1208(): void { say("bare/array-from/strict-eq", (Array.from([make1208()])[0]) === (Array.from([make1208()])[0])); }

function make1209(): () => number { return () => 1; }
function c1209(): void { say("bare/array-of/strict-eq", (Array.of(make1209())[0]) === (Array.of(make1209())[0])); }

function make1210(): () => number { return () => 1; }
function get1210(): unknown { const xs: unknown[] = []; xs.push(make1210()); return xs[0]; }
function c1210(): void { say("bare/push-then-read/strict-eq", (get1210()) === (get1210())); }

function make1211(): () => number { return () => 1; }
function c1211(): void { say("bare/set-iteration/strict-eq", ([...new Set([make1211()])][0]) === ([...new Set([make1211()])][0])); }

function make1212(): () => number { return () => 1; }
function c1212(): void { say("bare/map-get/strict-eq", (new Map([[1, make1212()]]).get(1)) === (new Map([[1, make1212()]]).get(1))); }

function make1213(): () => number { return () => 1; }
function self1213(this: unknown): unknown { return this; }
function c1213(): void { say("bare/bind-this/strict-eq", (self1213.bind(make1213())()) === (self1213.bind(make1213())())); }

function make1214(): () => number { return () => 1; }
function self1214(this: unknown): unknown { return this; }
function c1214(): void { say("bare/call-this/strict-eq", (self1214.call(make1214())) === (self1214.call(make1214()))); }

function make1215(): () => number { return () => 1; }
function first1215(x: unknown): unknown { return x; }
function c1215(): void { say("bare/apply-arguments/strict-eq", (first1215.apply(null, [make1215()])) === (first1215.apply(null, [make1215()]))); }

function make1216(): () => number { return () => 1; }
function first1216(x: unknown): unknown { return x; }
function c1216(): void { say("bare/reflect-apply/strict-eq", (Reflect.apply(first1216, null, [make1216()])) === (Reflect.apply(first1216, null, [make1216()]))); }

function make1217(): () => number { return () => 1; }
function c1217(): void { say("bare/logical-or/strict-eq", (((0 as unknown) || make1217())) === (((0 as unknown) || make1217()))); }

function make1218(): () => number { return () => 1; }
let none1218: unknown;
function c1218(): void { say("bare/nullish/strict-eq", ((none1218 ?? make1218())) === ((none1218 ?? make1218()))); }

function make1219(): () => number { return () => 1; }
function c1219(): void { say("bare/comma/strict-eq", ((out.length, make1219())) === ((out.length, make1219()))); }

function make1220(): () => number { return () => 1; }
function c1220(): void { say("bare/computed-member/strict-eq", (({ ["k"]: make1220() })["k"]) === (({ ["k"]: make1220() })["k"])); }

function make1221(): () => number { return () => 1; }
const s1221 = Symbol();
function c1221(): void { say("bare/symbol-member/strict-eq", (({ [s1221]: make1221() })[s1221]) === (({ [s1221]: make1221() })[s1221])); }

function make1222(): () => number { return () => 1; }
function c1222(): void { say("bare/getter-member/strict-eq", (({ get f(): unknown { return make1222(); } }).f) === (({ get f(): unknown { return make1222(); } }).f)); }

function make1223(): () => number { return () => 1; }
function c1223(): void { say("bare/proxy-get/strict-eq", (new Proxy({ f: make1223() as unknown }, {}).f) === (new Proxy({ f: make1223() as unknown }, {}).f)); }

function make1224(): () => number { return () => 1; }
function c1224(): void { say("bare/prototype-chain/strict-eq", (Object.create({ f: make1224() }).f) === (Object.create({ f: make1224() }).f)); }

function make1225(): () => number { return () => 1; }
function c1225(): void { say("bare/weak-ref/strict-eq", (new WeakRef(make1225() as object).deref()) === (new WeakRef(make1225() as object).deref())); }

function make1226(): () => number { return () => 1; }
function get1226(_x: unknown): unknown { return arguments[0]; }
function c1226(): void { say("bare/arguments-object/strict-eq", (get1226(make1226())) === (get1226(make1226()))); }

function make1227(): () => number { return () => 1; }
function get1227(n: number): unknown { return n === 0 ? make1227() : get1227(n - 1); }
function c1227(): void { say("bare/recursion/strict-eq", (get1227(2)) === (get1227(2))); }

function make1228(): () => number { return () => 1; }
function even1228(n: number): unknown { return n === 0 ? make1228() : odd1228(n - 1); }
function odd1228(n: number): unknown { return even1228(n - 1); }
function c1228(): void { say("bare/mutual-recursion/strict-eq", (even1228(2)) === (even1228(2))); }

function make1229(): () => number { return () => 1; }
function again1229(): () => number { return make1229(); }
function c1229(): void { say("bare/maker-forwarded/strict-eq", (again1229()) === (again1229())); }

function make1230(): () => number { return () => 1; }
function again1230(): () => number { return make1230(); }
function get1230(): unknown { return again1230(); }
function c1230(): void { say("bare/maker-forwarded-and-returned/strict-eq", (get1230()) === (get1230())); }

function make1231(): () => number { return () => 1; }
function build1231(f: () => () => number): () => number { return f(); }
function c1231(): void { say("bare/maker-as-a-callback/strict-eq", (build1231(make1231)) === (build1231(make1231))); }

function make1232(): () => number { return () => 1; }
function build1232(f: () => () => number): () => number { return f(); }
function get1232(): unknown { return build1232(make1232); }
function c1232(): void { say("bare/maker-as-a-callback-returned/strict-eq", (get1232()) === (get1232())); }

function make1233(): () => number { return () => 1; }
function box1233(): { t: () => number } { return { t: make1233() }; }
function get1233(): unknown { return box1233().t; }
function c1233(): void { say("bare/holder-through-a-record/strict-eq", (get1233()) === (get1233())); }

function make1234(): () => number { return () => 1; }
function box1234(): Array<() => number> { return [make1234()]; }
function get1234(): unknown { return box1234()[0]; }
function c1234(): void { say("bare/holder-through-an-array/strict-eq", (get1234()) === (get1234())); }

function make1235(): () => number { return () => 1; }
function box1235(): () => () => number { const t = make1235(); return () => t; }
function get1235(): unknown { return box1235()(); }
function c1235(): void { say("bare/holder-through-a-closure/strict-eq", (get1235()) === (get1235())); }

function make1236(): () => number { return () => 1; }
function get1236(): unknown { try { return make1236(); } finally { out.length; } }
function c1236(): void { say("bare/finally/strict-eq", (get1236()) === (get1236())); }

function make1237(): () => number { return () => 1; }
function get1237(n: number): unknown { switch (n) { case 1: return make1237(); default: return 0; } }
function c1237(): void { say("bare/switch-arm/strict-eq", (get1237(1)) === (get1237(1))); }

function make1238(): () => number { return () => 1; }
function c1238(): void { say("bare/object-from-entries/strict-eq", (Object.fromEntries([["k", make1238()]]).k) === (Object.fromEntries([["k", make1238()]]).k)); }

function make1239(): () => number { return () => 1; }
function get1239(): unknown { const t = make1239(); const u = { t, n: 1 }; const v = { u }; return v.u.t; }
function c1239(): void { say("bare/structured-holder/strict-eq", (get1239()) === (get1239())); }

function make1240(): () => number { return () => 1; }
function box1240(): { t: () => number } { return { t: make1240() }; }
function get1240(): unknown { return box1240().t; }
function c1240(): void { say("bare/holder-through-a-record/strict-ne", (get1240()) !== (get1240())); }

function make1241(): () => number { return () => 1; }
function box1241(): { t: () => number } { return { t: make1241() }; }
function get1241(): unknown { return box1241().t; }
function c1241(): void { say("bare/holder-through-a-record/loose-eq", (get1241()) == (get1241())); }

function make1242(): () => number { return () => 1; }
function box1242(): { t: () => number } { return { t: make1242() }; }
function get1242(): unknown { return box1242().t; }
function c1242(): void { say("bare/holder-through-a-record/object-is", Object.is((get1242()), (get1242()))); }

function make1243(): () => number { return () => 1; }
function box1243(): { t: () => number } { return { t: make1243() }; }
function get1243(): unknown { return box1243().t; }
function c1243(): void { say("bare/holder-through-a-record/set", new Set([(get1243()), (get1243())]).size); }

function make1244(): () => number { return () => 1; }
function box1244(): { t: () => number } { return { t: make1244() }; }
function get1244(): unknown { return box1244().t; }
function c1244(): void { say("bare/holder-through-a-record/map-key", new Map([[(get1244()), 1], [(get1244()), 2]]).size); }

function make1245(): () => number { return () => 1; }
function box1245(): { t: () => number } { return { t: make1245() }; }
function get1245(): unknown { return box1245().t; }
function c1245(): void { say("bare/holder-through-a-record/includes", [(get1245())].includes((get1245()))); }

function make1246(): () => number { return () => 1; }
function box1246(): { t: () => number } { return { t: make1246() }; }
function get1246(): unknown { return box1246().t; }
function c1246(): void { say("bare/holder-through-a-record/index-of", [(get1246())].indexOf((get1246()))); }

function make1247(): () => number { return () => 1; }
function box1247(): { t: () => number } { return { t: make1247() }; }
function get1247(): unknown { return box1247().t; }
const ws1247 = new WeakSet<object>();
function c1247(): void { say("bare/holder-through-a-record/weak-set", (ws1247.add((get1247()) as object), ws1247.has((get1247()) as object))); }

function make1248(): () => number { return () => 1; }
function box1248(): { t: () => number } { return { t: make1248() }; }
function get1248(): unknown { return box1248().t; }
const wm1248 = new WeakMap<object, number>();
function c1248(): void { say("bare/holder-through-a-record/weak-map", (wm1248.set((get1248()) as object, 1), wm1248.has((get1248()) as object))); }

function make1249(): () => number { return () => 1; }
function box1249(): { t: () => number } { return { t: make1249() }; }
function get1249(): unknown { return box1249().t; }
function c1249(): void { say("bare/holder-through-a-record/written", ((((get1249())) as any).tag = 1, (((get1249())) as any).tag)); }

function make1250(): () => number { return () => 1; }
function box1250(): { t: () => number } { return { t: make1250() }; }
function get1250(): unknown { return box1250().t; }
function c1250(): void { say("bare/holder-through-a-record/defined", (Object.defineProperty((get1250()) as object, "t", { value: 1 }), "t" in ((get1250()) as object))); }

function make1251(): () => number { return () => 1; }
function box1251(): { t: () => number } { return { t: make1251() }; }
function get1251(): unknown { return box1251().t; }
function c1251(): void { say("bare/holder-through-a-record/frozen", (Object.freeze((get1251())), Object.isFrozen((get1251())))); }

function make1252(): () => number { return () => 1; }
function box1252(): { t: () => number } { return { t: make1252() }; }
function get1252(): unknown { return box1252().t; }
function c1252(): void { say("bare/holder-through-a-record/prototype-set", (Object.setPrototypeOf((get1252()) as object, null), Object.getPrototypeOf((get1252())) === null)); }

function make1253(): () => number { return () => 1; }
function box1253(): { t: () => number } { return { t: make1253() }; }
function get1253(): unknown { return box1253().t; }
function c1253(): void { say("bare/holder-through-a-record/deleted", (delete (((get1253())) as any).length, Object.hasOwn((get1253()) as object, "length"))); }

function make1254(): () => number { return () => 1; }
function box1254(): { t: () => number } { return { t: make1254() }; }
function get1254(): unknown { return box1254().t; }
function same1254(a: unknown, b: unknown): boolean { return a === b; }
function c1254(): void { say("bare/holder-through-a-record/in-a-callee", same1254((get1254()), (get1254()))); }

function make1255(): () => number { return () => 1; }
function box1255(): { t: () => number } { return { t: make1255() }; }
function get1255(): unknown { return box1255().t; }
function hit1255(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c1255(): void { say("bare/holder-through-a-record/switch", hit1255((get1255()), (get1255()))); }

function make1256(): () => number { return () => 1; }
function box1256(): { t: () => number } { return { t: make1256() }; }
function get1256(): unknown { return box1256().t; }
let last1256: unknown;
function seen1256(f: unknown): boolean { const same = f === last1256; last1256 = f; return same; }
function c1256(): void { say("bare/holder-through-a-record/kept-then-compared", (seen1256((get1256())), seen1256((get1256())))); }

function make1257(): Map<string, () => number> { return new Map([["k", () => 1]]); }
class K1257 { #f: unknown; constructor() { this.#f = make1257().get("k"); } get(): unknown { return this.#f; } }
function c1257(): void { say("map/private-field/strict-eq", (new K1257().get()) === (new K1257().get())); }

function make1258(): Map<string, () => number> { return new Map([["k", () => 1]]); }
class K1258 { static f: unknown; }
function c1258(): void { say("map/static-field/strict-eq", ((K1258.f = make1258().get("k"), K1258.f)) === ((K1258.f = make1258().get("k"), K1258.f))); }

function make1259(): Map<string, () => number> { return new Map([["k", () => 1]]); }
class K1259 { f: unknown = make1259().get("k"); }
function c1259(): void { say("map/instance-field/strict-eq", (new K1259().f) === (new K1259().f)); }

function make1260(): Map<string, () => number> { return new Map([["k", () => 1]]); }
class K1260 { s: unknown; set v(x: unknown) { this.s = x; } }
function get1260(): unknown { const k = new K1260(); k.v = make1260().get("k"); return k.s; }
function c1260(): void { say("map/setter/strict-eq", (get1260()) === (get1260())); }

c1201(); c1202(); c1203(); c1204(); c1205(); c1206(); c1207(); c1208(); c1209(); c1210(); c1211(); c1212(); c1213(); c1214(); c1215(); c1216(); c1217(); c1218(); c1219(); c1220(); c1221(); c1222(); c1223(); c1224(); c1225(); c1226(); c1227(); c1228(); c1229(); c1230(); c1231(); c1232(); c1233(); c1234(); c1235(); c1236(); c1237(); c1238(); c1239(); c1240(); c1241(); c1242(); c1243(); c1244(); c1245(); c1246(); c1247(); c1248(); c1249(); c1250(); c1251(); c1252(); c1253(); c1254(); c1255(); c1256(); c1257(); c1258(); c1259(); c1260();
console.log(out.join("\n"));
