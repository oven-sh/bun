// Generated program: object and closure identity stays observable when allocations are removed (second series, part 22).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

function make1321(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1321(): { t: Map<string, () => number> } { return { t: make1321() }; }
function get1321(): unknown { return box1321().t.get("k"); }
function c1321(): void { say("map/holder-through-a-record/defined", (Object.defineProperty((get1321()) as object, "t", { value: 1 }), "t" in ((get1321()) as object))); }

function make1322(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1322(): { t: Map<string, () => number> } { return { t: make1322() }; }
function get1322(): unknown { return box1322().t.get("k"); }
function c1322(): void { say("map/holder-through-a-record/frozen", (Object.freeze((get1322())), Object.isFrozen((get1322())))); }

function make1323(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1323(): { t: Map<string, () => number> } { return { t: make1323() }; }
function get1323(): unknown { return box1323().t.get("k"); }
function c1323(): void { say("map/holder-through-a-record/prototype-set", (Object.setPrototypeOf((get1323()) as object, null), Object.getPrototypeOf((get1323())) === null)); }

function make1324(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1324(): { t: Map<string, () => number> } { return { t: make1324() }; }
function get1324(): unknown { return box1324().t.get("k"); }
function c1324(): void { say("map/holder-through-a-record/deleted", (delete (((get1324())) as any).length, Object.hasOwn((get1324()) as object, "length"))); }

function make1325(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1325(): { t: Map<string, () => number> } { return { t: make1325() }; }
function get1325(): unknown { return box1325().t.get("k"); }
function same1325(a: unknown, b: unknown): boolean { return a === b; }
function c1325(): void { say("map/holder-through-a-record/in-a-callee", same1325((get1325()), (get1325()))); }

function make1326(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1326(): { t: Map<string, () => number> } { return { t: make1326() }; }
function get1326(): unknown { return box1326().t.get("k"); }
function hit1326(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c1326(): void { say("map/holder-through-a-record/switch", hit1326((get1326()), (get1326()))); }

function make1327(): Map<string, () => number> { return new Map([["k", () => 1]]); }
function box1327(): { t: Map<string, () => number> } { return { t: make1327() }; }
function get1327(): unknown { return box1327().t.get("k"); }
let last1327: unknown;
function seen1327(f: unknown): boolean { const same = f === last1327; last1327 = f; return same; }
function c1327(): void { say("map/holder-through-a-record/kept-then-compared", (seen1327((get1327())), seen1327((get1327())))); }

interface R1328 { a1328: number; m1328?: () => number }
function make1328(): R1328 { const r: R1328 = { a1328: 1 }; r.m1328 = () => 1; return r; }
class K1328 { #f: unknown; constructor() { this.#f = make1328().m1328; } get(): unknown { return this.#f; } }
function c1328(): void { say("stored-later/private-field/strict-eq", (new K1328().get()) === (new K1328().get())); }

interface R1329 { a1329: number; m1329?: () => number }
function make1329(): R1329 { const r: R1329 = { a1329: 1 }; r.m1329 = () => 1; return r; }
class K1329 { static f: unknown; }
function c1329(): void { say("stored-later/static-field/strict-eq", ((K1329.f = make1329().m1329, K1329.f)) === ((K1329.f = make1329().m1329, K1329.f))); }

interface R1330 { a1330: number; m1330?: () => number }
function make1330(): R1330 { const r: R1330 = { a1330: 1 }; r.m1330 = () => 1; return r; }
class K1330 { f: unknown = make1330().m1330; }
function c1330(): void { say("stored-later/instance-field/strict-eq", (new K1330().f) === (new K1330().f)); }

interface R1331 { a1331: number; m1331?: () => number }
function make1331(): R1331 { const r: R1331 = { a1331: 1 }; r.m1331 = () => 1; return r; }
class K1331 { s: unknown; set v(x: unknown) { this.s = x; } }
function get1331(): unknown { const k = new K1331(); k.v = make1331().m1331; return k.s; }
function c1331(): void { say("stored-later/setter/strict-eq", (get1331()) === (get1331())); }

interface R1332 { a1332: number; m1332?: () => number }
function make1332(): R1332 { const r: R1332 = { a1332: 1 }; r.m1332 = () => 1; return r; }
class B1332 { get(): unknown { return make1332().m1332; } }
class D1332 extends B1332 { get(): unknown { return super.get(); } }
function c1332(): void { say("stored-later/super-method/strict-eq", (new D1332().get()) === (new D1332().get())); }

interface R1333 { a1333: number; m1333?: () => number }
function make1333(): R1333 { const r: R1333 = { a1333: 1 }; r.m1333 = () => 1; return r; }
class K1333 { constructor(public f: unknown) {} }
function c1333(): void { say("stored-later/constructor-parameter/strict-eq", (new K1333(make1333().m1333).f) === (new K1333(make1333().m1333).f)); }

interface R1334 { a1334: number; m1334?: () => number }
function make1334(): R1334 { const r: R1334 = { a1334: 1 }; r.m1334 = () => 1; return r; }
function tag1334(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c1334(): void { say("stored-later/tagged-template/strict-eq", (tag1334`${make1334().m1334}`) === (tag1334`${make1334().m1334}`)); }

interface R1335 { a1335: number; m1335?: () => number }
function make1335(): R1335 { const r: R1335 = { a1335: 1 }; r.m1335 = () => 1; return r; }
function get1335(x: unknown = make1335().m1335): unknown { return x; }
function c1335(): void { say("stored-later/default-parameter/strict-eq", (get1335()) === (get1335())); }

interface R1336 { a1336: number; m1336?: () => number }
function make1336(): R1336 { const r: R1336 = { a1336: 1 }; r.m1336 = () => 1; return r; }
function get1336({ f = make1336().m1336 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c1336(): void { say("stored-later/pattern-default/strict-eq", (get1336()) === (get1336())); }

interface R1337 { a1337: number; m1337?: () => number }
function make1337(): R1337 { const r: R1337 = { a1337: 1 }; r.m1337 = () => 1; return r; }
function get1337(): unknown { const [f] = [make1337().m1337]; return f; }
function c1337(): void { say("stored-later/array-pattern/strict-eq", (get1337()) === (get1337())); }

interface R1338 { a1338: number; m1338?: () => number }
function make1338(): R1338 { const r: R1338 = { a1338: 1 }; r.m1338 = () => 1; return r; }
function get1338(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make1338().m1338; } }; for (const f of it) return f; return 0; }
function c1338(): void { say("stored-later/custom-iterable/strict-eq", (get1338()) === (get1338())); }

interface R1339 { a1339: number; m1339?: () => number }
function make1339(): R1339 { const r: R1339 = { a1339: 1 }; r.m1339 = () => 1; return r; }
function c1339(): void { say("stored-later/map-callback/strict-eq", ([0].map(() => make1339().m1339)[0]) === ([0].map(() => make1339().m1339)[0])); }

interface R1340 { a1340: number; m1340?: () => number }
function make1340(): R1340 { const r: R1340 = { a1340: 1 }; r.m1340 = () => 1; return r; }
function c1340(): void { say("stored-later/find/strict-eq", ([make1340().m1340].find(() => true)) === ([make1340().m1340].find(() => true))); }

interface R1341 { a1341: number; m1341?: () => number }
function make1341(): R1341 { const r: R1341 = { a1341: 1 }; r.m1341 = () => 1; return r; }
function c1341(): void { say("stored-later/reduce/strict-eq", ([make1341().m1341 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) === ([make1341().m1341 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))); }

interface R1342 { a1342: number; m1342?: () => number }
function make1342(): R1342 { const r: R1342 = { a1342: 1 }; r.m1342 = () => 1; return r; }
function c1342(): void { say("stored-later/filter/strict-eq", ([make1342().m1342].filter(() => true)[0]) === ([make1342().m1342].filter(() => true)[0])); }

interface R1343 { a1343: number; m1343?: () => number }
function make1343(): R1343 { const r: R1343 = { a1343: 1 }; r.m1343 = () => 1; return r; }
function c1343(): void { say("stored-later/flat/strict-eq", ([[make1343().m1343]].flat()[0]) === ([[make1343().m1343]].flat()[0])); }

interface R1344 { a1344: number; m1344?: () => number }
function make1344(): R1344 { const r: R1344 = { a1344: 1 }; r.m1344 = () => 1; return r; }
function c1344(): void { say("stored-later/at/strict-eq", ([make1344().m1344].at(0)) === ([make1344().m1344].at(0))); }

interface R1345 { a1345: number; m1345?: () => number }
function make1345(): R1345 { const r: R1345 = { a1345: 1 }; r.m1345 = () => 1; return r; }
function c1345(): void { say("stored-later/pop/strict-eq", ([make1345().m1345].pop()) === ([make1345().m1345].pop())); }

interface R1346 { a1346: number; m1346?: () => number }
function make1346(): R1346 { const r: R1346 = { a1346: 1 }; r.m1346 = () => 1; return r; }
function c1346(): void { say("stored-later/shift/strict-eq", ([make1346().m1346].shift()) === ([make1346().m1346].shift())); }

interface R1347 { a1347: number; m1347?: () => number }
function make1347(): R1347 { const r: R1347 = { a1347: 1 }; r.m1347 = () => 1; return r; }
function c1347(): void { say("stored-later/slice/strict-eq", ([make1347().m1347].slice()[0]) === ([make1347().m1347].slice()[0])); }

interface R1348 { a1348: number; m1348?: () => number }
function make1348(): R1348 { const r: R1348 = { a1348: 1 }; r.m1348 = () => 1; return r; }
function c1348(): void { say("stored-later/concat/strict-eq", (([] as unknown[]).concat([make1348().m1348])[0]) === (([] as unknown[]).concat([make1348().m1348])[0])); }

interface R1349 { a1349: number; m1349?: () => number }
function make1349(): R1349 { const r: R1349 = { a1349: 1 }; r.m1349 = () => 1; return r; }
function c1349(): void { say("stored-later/spread-array/strict-eq", ([...[make1349().m1349]][0]) === ([...[make1349().m1349]][0])); }

interface R1350 { a1350: number; m1350?: () => number }
function make1350(): R1350 { const r: R1350 = { a1350: 1 }; r.m1350 = () => 1; return r; }
function c1350(): void { say("stored-later/array-from/strict-eq", (Array.from([make1350().m1350])[0]) === (Array.from([make1350().m1350])[0])); }

interface R1351 { a1351: number; m1351?: () => number }
function make1351(): R1351 { const r: R1351 = { a1351: 1 }; r.m1351 = () => 1; return r; }
function c1351(): void { say("stored-later/array-of/strict-eq", (Array.of(make1351().m1351)[0]) === (Array.of(make1351().m1351)[0])); }

interface R1352 { a1352: number; m1352?: () => number }
function make1352(): R1352 { const r: R1352 = { a1352: 1 }; r.m1352 = () => 1; return r; }
function get1352(): unknown { const xs: unknown[] = []; xs.push(make1352().m1352); return xs[0]; }
function c1352(): void { say("stored-later/push-then-read/strict-eq", (get1352()) === (get1352())); }

interface R1353 { a1353: number; m1353?: () => number }
function make1353(): R1353 { const r: R1353 = { a1353: 1 }; r.m1353 = () => 1; return r; }
function c1353(): void { say("stored-later/set-iteration/strict-eq", ([...new Set([make1353().m1353])][0]) === ([...new Set([make1353().m1353])][0])); }

interface R1354 { a1354: number; m1354?: () => number }
function make1354(): R1354 { const r: R1354 = { a1354: 1 }; r.m1354 = () => 1; return r; }
function c1354(): void { say("stored-later/map-get/strict-eq", (new Map([[1, make1354().m1354]]).get(1)) === (new Map([[1, make1354().m1354]]).get(1))); }

interface R1355 { a1355: number; m1355?: () => number }
function make1355(): R1355 { const r: R1355 = { a1355: 1 }; r.m1355 = () => 1; return r; }
function self1355(this: unknown): unknown { return this; }
function c1355(): void { say("stored-later/bind-this/strict-eq", (self1355.bind(make1355().m1355)()) === (self1355.bind(make1355().m1355)())); }

interface R1356 { a1356: number; m1356?: () => number }
function make1356(): R1356 { const r: R1356 = { a1356: 1 }; r.m1356 = () => 1; return r; }
function self1356(this: unknown): unknown { return this; }
function c1356(): void { say("stored-later/call-this/strict-eq", (self1356.call(make1356().m1356)) === (self1356.call(make1356().m1356))); }

interface R1357 { a1357: number; m1357?: () => number }
function make1357(): R1357 { const r: R1357 = { a1357: 1 }; r.m1357 = () => 1; return r; }
function first1357(x: unknown): unknown { return x; }
function c1357(): void { say("stored-later/apply-arguments/strict-eq", (first1357.apply(null, [make1357().m1357])) === (first1357.apply(null, [make1357().m1357]))); }

interface R1358 { a1358: number; m1358?: () => number }
function make1358(): R1358 { const r: R1358 = { a1358: 1 }; r.m1358 = () => 1; return r; }
function first1358(x: unknown): unknown { return x; }
function c1358(): void { say("stored-later/reflect-apply/strict-eq", (Reflect.apply(first1358, null, [make1358().m1358])) === (Reflect.apply(first1358, null, [make1358().m1358]))); }

interface R1359 { a1359: number; m1359?: () => number }
function make1359(): R1359 { const r: R1359 = { a1359: 1 }; r.m1359 = () => 1; return r; }
function c1359(): void { say("stored-later/logical-or/strict-eq", (((0 as unknown) || make1359().m1359)) === (((0 as unknown) || make1359().m1359))); }

interface R1360 { a1360: number; m1360?: () => number }
function make1360(): R1360 { const r: R1360 = { a1360: 1 }; r.m1360 = () => 1; return r; }
let none1360: unknown;
function c1360(): void { say("stored-later/nullish/strict-eq", ((none1360 ?? make1360().m1360)) === ((none1360 ?? make1360().m1360))); }

interface R1361 { a1361: number; m1361?: () => number }
function make1361(): R1361 { const r: R1361 = { a1361: 1 }; r.m1361 = () => 1; return r; }
function c1361(): void { say("stored-later/comma/strict-eq", ((out.length, make1361().m1361)) === ((out.length, make1361().m1361))); }

interface R1362 { a1362: number; m1362?: () => number }
function make1362(): R1362 { const r: R1362 = { a1362: 1 }; r.m1362 = () => 1; return r; }
function c1362(): void { say("stored-later/computed-member/strict-eq", (({ ["k"]: make1362().m1362 })["k"]) === (({ ["k"]: make1362().m1362 })["k"])); }

interface R1363 { a1363: number; m1363?: () => number }
function make1363(): R1363 { const r: R1363 = { a1363: 1 }; r.m1363 = () => 1; return r; }
const s1363 = Symbol();
function c1363(): void { say("stored-later/symbol-member/strict-eq", (({ [s1363]: make1363().m1363 })[s1363]) === (({ [s1363]: make1363().m1363 })[s1363])); }

interface R1364 { a1364: number; m1364?: () => number }
function make1364(): R1364 { const r: R1364 = { a1364: 1 }; r.m1364 = () => 1; return r; }
function c1364(): void { say("stored-later/getter-member/strict-eq", (({ get f(): unknown { return make1364().m1364; } }).f) === (({ get f(): unknown { return make1364().m1364; } }).f)); }

interface R1365 { a1365: number; m1365?: () => number }
function make1365(): R1365 { const r: R1365 = { a1365: 1 }; r.m1365 = () => 1; return r; }
function c1365(): void { say("stored-later/proxy-get/strict-eq", (new Proxy({ f: make1365().m1365 as unknown }, {}).f) === (new Proxy({ f: make1365().m1365 as unknown }, {}).f)); }

interface R1366 { a1366: number; m1366?: () => number }
function make1366(): R1366 { const r: R1366 = { a1366: 1 }; r.m1366 = () => 1; return r; }
function c1366(): void { say("stored-later/prototype-chain/strict-eq", (Object.create({ f: make1366().m1366 }).f) === (Object.create({ f: make1366().m1366 }).f)); }

interface R1367 { a1367: number; m1367?: () => number }
function make1367(): R1367 { const r: R1367 = { a1367: 1 }; r.m1367 = () => 1; return r; }
function c1367(): void { say("stored-later/weak-ref/strict-eq", (new WeakRef(make1367().m1367 as object).deref()) === (new WeakRef(make1367().m1367 as object).deref())); }

interface R1368 { a1368: number; m1368?: () => number }
function make1368(): R1368 { const r: R1368 = { a1368: 1 }; r.m1368 = () => 1; return r; }
function get1368(_x: unknown): unknown { return arguments[0]; }
function c1368(): void { say("stored-later/arguments-object/strict-eq", (get1368(make1368().m1368)) === (get1368(make1368().m1368))); }

interface R1369 { a1369: number; m1369?: () => number }
function make1369(): R1369 { const r: R1369 = { a1369: 1 }; r.m1369 = () => 1; return r; }
function get1369(n: number): unknown { return n === 0 ? make1369().m1369 : get1369(n - 1); }
function c1369(): void { say("stored-later/recursion/strict-eq", (get1369(2)) === (get1369(2))); }

interface R1370 { a1370: number; m1370?: () => number }
function make1370(): R1370 { const r: R1370 = { a1370: 1 }; r.m1370 = () => 1; return r; }
function even1370(n: number): unknown { return n === 0 ? make1370().m1370 : odd1370(n - 1); }
function odd1370(n: number): unknown { return even1370(n - 1); }
function c1370(): void { say("stored-later/mutual-recursion/strict-eq", (even1370(2)) === (even1370(2))); }

interface R1371 { a1371: number; m1371?: () => number }
function make1371(): R1371 { const r: R1371 = { a1371: 1 }; r.m1371 = () => 1; return r; }
function again1371(): R1371 { return make1371(); }
function c1371(): void { say("stored-later/maker-forwarded/strict-eq", (again1371().m1371) === (again1371().m1371)); }

interface R1372 { a1372: number; m1372?: () => number }
function make1372(): R1372 { const r: R1372 = { a1372: 1 }; r.m1372 = () => 1; return r; }
function again1372(): R1372 { return make1372(); }
function get1372(): unknown { return again1372().m1372; }
function c1372(): void { say("stored-later/maker-forwarded-and-returned/strict-eq", (get1372()) === (get1372())); }

interface R1373 { a1373: number; m1373?: () => number }
function make1373(): R1373 { const r: R1373 = { a1373: 1 }; r.m1373 = () => 1; return r; }
function build1373(f: () => R1373): R1373 { return f(); }
function c1373(): void { say("stored-later/maker-as-a-callback/strict-eq", (build1373(make1373).m1373) === (build1373(make1373).m1373)); }

interface R1374 { a1374: number; m1374?: () => number }
function make1374(): R1374 { const r: R1374 = { a1374: 1 }; r.m1374 = () => 1; return r; }
function build1374(f: () => R1374): R1374 { return f(); }
function get1374(): unknown { return build1374(make1374).m1374; }
function c1374(): void { say("stored-later/maker-as-a-callback-returned/strict-eq", (get1374()) === (get1374())); }

interface R1375 { a1375: number; m1375?: () => number }
function make1375(): R1375 { const r: R1375 = { a1375: 1 }; r.m1375 = () => 1; return r; }
function box1375(): { t: R1375 } { return { t: make1375() }; }
function get1375(): unknown { return box1375().t.m1375; }
function c1375(): void { say("stored-later/holder-through-a-record/strict-eq", (get1375()) === (get1375())); }

interface R1376 { a1376: number; m1376?: () => number }
function make1376(): R1376 { const r: R1376 = { a1376: 1 }; r.m1376 = () => 1; return r; }
function box1376(): Array<R1376> { return [make1376()]; }
function get1376(): unknown { return box1376()[0].m1376; }
function c1376(): void { say("stored-later/holder-through-an-array/strict-eq", (get1376()) === (get1376())); }

interface R1377 { a1377: number; m1377?: () => number }
function make1377(): R1377 { const r: R1377 = { a1377: 1 }; r.m1377 = () => 1; return r; }
function box1377(): () => R1377 { const t = make1377(); return () => t; }
function get1377(): unknown { return box1377()().m1377; }
function c1377(): void { say("stored-later/holder-through-a-closure/strict-eq", (get1377()) === (get1377())); }

interface R1378 { a1378: number; m1378?: () => number }
function make1378(): R1378 { const r: R1378 = { a1378: 1 }; r.m1378 = () => 1; return r; }
function get1378(): unknown { try { return make1378().m1378; } finally { out.length; } }
function c1378(): void { say("stored-later/finally/strict-eq", (get1378()) === (get1378())); }

interface R1379 { a1379: number; m1379?: () => number }
function make1379(): R1379 { const r: R1379 = { a1379: 1 }; r.m1379 = () => 1; return r; }
function get1379(n: number): unknown { switch (n) { case 1: return make1379().m1379; default: return 0; } }
function c1379(): void { say("stored-later/switch-arm/strict-eq", (get1379(1)) === (get1379(1))); }

interface R1380 { a1380: number; m1380?: () => number }
function make1380(): R1380 { const r: R1380 = { a1380: 1 }; r.m1380 = () => 1; return r; }
function c1380(): void { say("stored-later/object-from-entries/strict-eq", (Object.fromEntries([["k", make1380().m1380]]).k) === (Object.fromEntries([["k", make1380().m1380]]).k)); }

c1321(); c1322(); c1323(); c1324(); c1325(); c1326(); c1327(); c1328(); c1329(); c1330(); c1331(); c1332(); c1333(); c1334(); c1335(); c1336(); c1337(); c1338(); c1339(); c1340(); c1341(); c1342(); c1343(); c1344(); c1345(); c1346(); c1347(); c1348(); c1349(); c1350(); c1351(); c1352(); c1353(); c1354(); c1355(); c1356(); c1357(); c1358(); c1359(); c1360(); c1361(); c1362(); c1363(); c1364(); c1365(); c1366(); c1367(); c1368(); c1369(); c1370(); c1371(); c1372(); c1373(); c1374(); c1375(); c1376(); c1377(); c1378(); c1379(); c1380();
console.log(out.join("\n"));
