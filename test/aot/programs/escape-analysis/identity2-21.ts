// Generated program: object and closure identity stays observable when allocations are removed (second series, part 21).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

function make1261(): Map<string, () => number> { return new Map([["k", () => 1]]); }
class B1261 { get(): unknown { return make1261().get("k"); } }
class D1261 extends B1261 { get(): unknown { return super.get(); } }
function c1261(): void { say("map/super-method/strict-eq", (new D1261().get()) === (new D1261().get())); }

function make1262(): Map<string, () => number> { return new Map([["k", () => 1]]); }
class K1262 { constructor(public f: unknown) {} }
function c1262(): void { say("map/constructor-parameter/strict-eq", (new K1262(make1262().get("k")).f) === (new K1262(make1262().get("k")).f)); }

function make1263(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function tag1263(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c1263(): void { say("map/tagged-template/strict-eq", (tag1263`${make1263().get("k")}`) === (tag1263`${make1263().get("k")}`)); }

function make1264(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get1264(x: unknown = make1264().get("k")): unknown { return x; }
function c1264(): void { say("map/default-parameter/strict-eq", (get1264()) === (get1264())); }

function make1265(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get1265({ f = make1265().get("k") as unknown }: { f?: unknown } = {}): unknown { return f; }
function c1265(): void { say("map/pattern-default/strict-eq", (get1265()) === (get1265())); }

function make1266(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get1266(): unknown { const [f] = [make1266().get("k")]; return f; }
function c1266(): void { say("map/array-pattern/strict-eq", (get1266()) === (get1266())); }

function make1267(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get1267(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make1267().get("k"); } }; for (const f of it) return f; return 0; }
function c1267(): void { say("map/custom-iterable/strict-eq", (get1267()) === (get1267())); }

function make1268(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1268(): void { say("map/map-callback/strict-eq", ([0].map(() => make1268().get("k"))[0]) === ([0].map(() => make1268().get("k"))[0])); }

function make1269(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1269(): void { say("map/find/strict-eq", ([make1269().get("k")].find(() => true)) === ([make1269().get("k")].find(() => true))); }

function make1270(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1270(): void { say("map/reduce/strict-eq", ([make1270().get("k") as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) === ([make1270().get("k") as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))); }

function make1271(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1271(): void { say("map/filter/strict-eq", ([make1271().get("k")].filter(() => true)[0]) === ([make1271().get("k")].filter(() => true)[0])); }

function make1272(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1272(): void { say("map/flat/strict-eq", ([[make1272().get("k")]].flat()[0]) === ([[make1272().get("k")]].flat()[0])); }

function make1273(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1273(): void { say("map/at/strict-eq", ([make1273().get("k")].at(0)) === ([make1273().get("k")].at(0))); }

function make1274(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1274(): void { say("map/pop/strict-eq", ([make1274().get("k")].pop()) === ([make1274().get("k")].pop())); }

function make1275(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1275(): void { say("map/shift/strict-eq", ([make1275().get("k")].shift()) === ([make1275().get("k")].shift())); }

function make1276(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1276(): void { say("map/slice/strict-eq", ([make1276().get("k")].slice()[0]) === ([make1276().get("k")].slice()[0])); }

function make1277(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1277(): void { say("map/concat/strict-eq", (([] as unknown[]).concat([make1277().get("k")])[0]) === (([] as unknown[]).concat([make1277().get("k")])[0])); }

function make1278(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1278(): void { say("map/spread-array/strict-eq", ([...[make1278().get("k")]][0]) === ([...[make1278().get("k")]][0])); }

function make1279(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1279(): void { say("map/array-from/strict-eq", (Array.from([make1279().get("k")])[0]) === (Array.from([make1279().get("k")])[0])); }

function make1280(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1280(): void { say("map/array-of/strict-eq", (Array.of(make1280().get("k"))[0]) === (Array.of(make1280().get("k"))[0])); }

function make1281(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get1281(): unknown { const xs: unknown[] = []; xs.push(make1281().get("k")); return xs[0]; }
function c1281(): void { say("map/push-then-read/strict-eq", (get1281()) === (get1281())); }

function make1282(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1282(): void { say("map/set-iteration/strict-eq", ([...new Set([make1282().get("k")])][0]) === ([...new Set([make1282().get("k")])][0])); }

function make1283(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1283(): void { say("map/map-get/strict-eq", (new Map([[1, make1283().get("k")]]).get(1)) === (new Map([[1, make1283().get("k")]]).get(1))); }

function make1284(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function self1284(this: unknown): unknown { return this; }
function c1284(): void { say("map/bind-this/strict-eq", (self1284.bind(make1284().get("k"))()) === (self1284.bind(make1284().get("k"))())); }

function make1285(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function self1285(this: unknown): unknown { return this; }
function c1285(): void { say("map/call-this/strict-eq", (self1285.call(make1285().get("k"))) === (self1285.call(make1285().get("k")))); }

function make1286(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function first1286(x: unknown): unknown { return x; }
function c1286(): void { say("map/apply-arguments/strict-eq", (first1286.apply(null, [make1286().get("k")])) === (first1286.apply(null, [make1286().get("k")]))); }

function make1287(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function first1287(x: unknown): unknown { return x; }
function c1287(): void { say("map/reflect-apply/strict-eq", (Reflect.apply(first1287, null, [make1287().get("k")])) === (Reflect.apply(first1287, null, [make1287().get("k")]))); }

function make1288(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1288(): void { say("map/logical-or/strict-eq", (((0 as unknown) || make1288().get("k"))) === (((0 as unknown) || make1288().get("k")))); }

function make1289(): Map<string, () => number> { return new Map([["k", () => 1]]); }
let none1289: unknown;
function c1289(): void { say("map/nullish/strict-eq", ((none1289 ?? make1289().get("k"))) === ((none1289 ?? make1289().get("k")))); }

function make1290(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1290(): void { say("map/comma/strict-eq", ((out.length, make1290().get("k"))) === ((out.length, make1290().get("k")))); }

function make1291(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1291(): void { say("map/computed-member/strict-eq", (({ ["k"]: make1291().get("k") })["k"]) === (({ ["k"]: make1291().get("k") })["k"])); }

function make1292(): Map<string, () => number> { return new Map([["k", () => 1]]); }
const s1292 = Symbol();
function c1292(): void { say("map/symbol-member/strict-eq", (({ [s1292]: make1292().get("k") })[s1292]) === (({ [s1292]: make1292().get("k") })[s1292])); }

function make1293(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1293(): void { say("map/getter-member/strict-eq", (({ get f(): unknown { return make1293().get("k"); } }).f) === (({ get f(): unknown { return make1293().get("k"); } }).f)); }

function make1294(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1294(): void { say("map/proxy-get/strict-eq", (new Proxy({ f: make1294().get("k") as unknown }, {}).f) === (new Proxy({ f: make1294().get("k") as unknown }, {}).f)); }

function make1295(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1295(): void { say("map/prototype-chain/strict-eq", (Object.create({ f: make1295().get("k") }).f) === (Object.create({ f: make1295().get("k") }).f)); }

function make1296(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1296(): void { say("map/weak-ref/strict-eq", (new WeakRef(make1296().get("k") as object).deref()) === (new WeakRef(make1296().get("k") as object).deref())); }

function make1297(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get1297(_x: unknown): unknown { return arguments[0]; }
function c1297(): void { say("map/arguments-object/strict-eq", (get1297(make1297().get("k"))) === (get1297(make1297().get("k")))); }

function make1298(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get1298(n: number): unknown { return n === 0 ? make1298().get("k") : get1298(n - 1); }
function c1298(): void { say("map/recursion/strict-eq", (get1298(2)) === (get1298(2))); }

function make1299(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function even1299(n: number): unknown { return n === 0 ? make1299().get("k") : odd1299(n - 1); }
function odd1299(n: number): unknown { return even1299(n - 1); }
function c1299(): void { say("map/mutual-recursion/strict-eq", (even1299(2)) === (even1299(2))); }

function make1300(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function again1300(): Map<string, () => number> { return make1300(); }
function c1300(): void { say("map/maker-forwarded/strict-eq", (again1300().get("k")) === (again1300().get("k"))); }

function make1301(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function again1301(): Map<string, () => number> { return make1301(); }
function get1301(): unknown { return again1301().get("k"); }
function c1301(): void { say("map/maker-forwarded-and-returned/strict-eq", (get1301()) === (get1301())); }

function make1302(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function build1302(f: () => Map<string, () => number>): Map<string, () => number> { return f(); }
function c1302(): void { say("map/maker-as-a-callback/strict-eq", (build1302(make1302).get("k")) === (build1302(make1302).get("k"))); }

function make1303(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function build1303(f: () => Map<string, () => number>): Map<string, () => number> { return f(); }
function get1303(): unknown { return build1303(make1303).get("k"); }
function c1303(): void { say("map/maker-as-a-callback-returned/strict-eq", (get1303()) === (get1303())); }

function make1304(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1304(): { t: Map<string, () => number> } { return { t: make1304() }; }
function get1304(): unknown { return box1304().t.get("k"); }
function c1304(): void { say("map/holder-through-a-record/strict-eq", (get1304()) === (get1304())); }

function make1305(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1305(): Array<Map<string, () => number>> { return [make1305()]; }
function get1305(): unknown { return box1305()[0].get("k"); }
function c1305(): void { say("map/holder-through-an-array/strict-eq", (get1305()) === (get1305())); }

function make1306(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1306(): () => Map<string, () => number> { const t = make1306(); return () => t; }
function get1306(): unknown { return box1306()().get("k"); }
function c1306(): void { say("map/holder-through-a-closure/strict-eq", (get1306()) === (get1306())); }

function make1307(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get1307(): unknown { try { return make1307().get("k"); } finally { out.length; } }
function c1307(): void { say("map/finally/strict-eq", (get1307()) === (get1307())); }

function make1308(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get1308(n: number): unknown { switch (n) { case 1: return make1308().get("k"); default: return 0; } }
function c1308(): void { say("map/switch-arm/strict-eq", (get1308(1)) === (get1308(1))); }

function make1309(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function c1309(): void { say("map/object-from-entries/strict-eq", (Object.fromEntries([["k", make1309().get("k")]]).k) === (Object.fromEntries([["k", make1309().get("k")]]).k)); }

function make1310(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function get1310(): unknown { const t = make1310(); const u = { t, n: 1 }; const v = { u }; return v.u.t.get("k"); }
function c1310(): void { say("map/structured-holder/strict-eq", (get1310()) === (get1310())); }

function make1311(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1311(): { t: Map<string, () => number> } { return { t: make1311() }; }
function get1311(): unknown { return box1311().t.get("k"); }
function c1311(): void { say("map/holder-through-a-record/strict-ne", (get1311()) !== (get1311())); }

function make1312(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1312(): { t: Map<string, () => number> } { return { t: make1312() }; }
function get1312(): unknown { return box1312().t.get("k"); }
function c1312(): void { say("map/holder-through-a-record/loose-eq", (get1312()) == (get1312())); }

function make1313(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1313(): { t: Map<string, () => number> } { return { t: make1313() }; }
function get1313(): unknown { return box1313().t.get("k"); }
function c1313(): void { say("map/holder-through-a-record/object-is", Object.is((get1313()), (get1313()))); }

function make1314(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1314(): { t: Map<string, () => number> } { return { t: make1314() }; }
function get1314(): unknown { return box1314().t.get("k"); }
function c1314(): void { say("map/holder-through-a-record/set", new Set([(get1314()), (get1314())]).size); }

function make1315(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1315(): { t: Map<string, () => number> } { return { t: make1315() }; }
function get1315(): unknown { return box1315().t.get("k"); }
function c1315(): void { say("map/holder-through-a-record/map-key", new Map([[(get1315()), 1], [(get1315()), 2]]).size); }

function make1316(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1316(): { t: Map<string, () => number> } { return { t: make1316() }; }
function get1316(): unknown { return box1316().t.get("k"); }
function c1316(): void { say("map/holder-through-a-record/includes", [(get1316())].includes((get1316()))); }

function make1317(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1317(): { t: Map<string, () => number> } { return { t: make1317() }; }
function get1317(): unknown { return box1317().t.get("k"); }
function c1317(): void { say("map/holder-through-a-record/index-of", [(get1317())].indexOf((get1317()))); }

function make1318(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1318(): { t: Map<string, () => number> } { return { t: make1318() }; }
function get1318(): unknown { return box1318().t.get("k"); }
const ws1318 = new WeakSet<object>();
function c1318(): void { say("map/holder-through-a-record/weak-set", (ws1318.add((get1318()) as object), ws1318.has((get1318()) as object))); }

function make1319(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1319(): { t: Map<string, () => number> } { return { t: make1319() }; }
function get1319(): unknown { return box1319().t.get("k"); }
const wm1319 = new WeakMap<object, number>();
function c1319(): void { say("map/holder-through-a-record/weak-map", (wm1319.set((get1319()) as object, 1), wm1319.has((get1319()) as object))); }

function make1320(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1320(): { t: Map<string, () => number> } { return { t: make1320() }; }
function get1320(): unknown { return box1320().t.get("k"); }
function c1320(): void { say("map/holder-through-a-record/written", ((((get1320())) as any).tag = 1, (((get1320())) as any).tag)); }

c1261(); c1262(); c1263(); c1264(); c1265(); c1266(); c1267(); c1268(); c1269(); c1270(); c1271(); c1272(); c1273(); c1274(); c1275(); c1276(); c1277(); c1278(); c1279(); c1280(); c1281(); c1282(); c1283(); c1284(); c1285(); c1286(); c1287(); c1288(); c1289(); c1290(); c1291(); c1292(); c1293(); c1294(); c1295(); c1296(); c1297(); c1298(); c1299(); c1300(); c1301(); c1302(); c1303(); c1304(); c1305(); c1306(); c1307(); c1308(); c1309(); c1310(); c1311(); c1312(); c1313(); c1314(); c1315(); c1316(); c1317(); c1318(); c1319(); c1320();
console.log(out.join("\n"));
