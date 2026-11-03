// Generated program: object and closure identity stays observable when allocations are removed (second series, part 23).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R1381 { a1381: number; m1381?: () => number }
function make1381(): R1381 { const r: R1381 = { a1381: 1 }; r.m1381 = () => 1; return r; }
function get1381(): unknown { const t = make1381(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m1381; }
function c1381(): void { say("stored-later/structured-holder/strict-eq", (get1381()) === (get1381())); }

interface R1382 { a1382: number; m1382?: () => number }
function make1382(): R1382 { const r: R1382 = { a1382: 1 }; r.m1382 = () => 1; return r; }
function box1382(): { t: R1382 } { return { t: make1382() }; }
function get1382(): unknown { return box1382().t.m1382; }
function c1382(): void { say("stored-later/holder-through-a-record/strict-ne", (get1382()) !== (get1382())); }

interface R1383 { a1383: number; m1383?: () => number }
function make1383(): R1383 { const r: R1383 = { a1383: 1 }; r.m1383 = () => 1; return r; }
function box1383(): { t: R1383 } { return { t: make1383() }; }
function get1383(): unknown { return box1383().t.m1383; }
function c1383(): void { say("stored-later/holder-through-a-record/loose-eq", (get1383()) == (get1383())); }

interface R1384 { a1384: number; m1384?: () => number }
function make1384(): R1384 { const r: R1384 = { a1384: 1 }; r.m1384 = () => 1; return r; }
function box1384(): { t: R1384 } { return { t: make1384() }; }
function get1384(): unknown { return box1384().t.m1384; }
function c1384(): void { say("stored-later/holder-through-a-record/object-is", Object.is((get1384()), (get1384()))); }

interface R1385 { a1385: number; m1385?: () => number }
function make1385(): R1385 { const r: R1385 = { a1385: 1 }; r.m1385 = () => 1; return r; }
function box1385(): { t: R1385 } { return { t: make1385() }; }
function get1385(): unknown { return box1385().t.m1385; }
function c1385(): void { say("stored-later/holder-through-a-record/set", new Set([(get1385()), (get1385())]).size); }

interface R1386 { a1386: number; m1386?: () => number }
function make1386(): R1386 { const r: R1386 = { a1386: 1 }; r.m1386 = () => 1; return r; }
function box1386(): { t: R1386 } { return { t: make1386() }; }
function get1386(): unknown { return box1386().t.m1386; }
function c1386(): void { say("stored-later/holder-through-a-record/map-key", new Map([[(get1386()), 1], [(get1386()), 2]]).size); }

interface R1387 { a1387: number; m1387?: () => number }
function make1387(): R1387 { const r: R1387 = { a1387: 1 }; r.m1387 = () => 1; return r; }
function box1387(): { t: R1387 } { return { t: make1387() }; }
function get1387(): unknown { return box1387().t.m1387; }
function c1387(): void { say("stored-later/holder-through-a-record/includes", [(get1387())].includes((get1387()))); }

interface R1388 { a1388: number; m1388?: () => number }
function make1388(): R1388 { const r: R1388 = { a1388: 1 }; r.m1388 = () => 1; return r; }
function box1388(): { t: R1388 } { return { t: make1388() }; }
function get1388(): unknown { return box1388().t.m1388; }
function c1388(): void { say("stored-later/holder-through-a-record/index-of", [(get1388())].indexOf((get1388()))); }

interface R1389 { a1389: number; m1389?: () => number }
function make1389(): R1389 { const r: R1389 = { a1389: 1 }; r.m1389 = () => 1; return r; }
function box1389(): { t: R1389 } { return { t: make1389() }; }
function get1389(): unknown { return box1389().t.m1389; }
const ws1389 = new WeakSet<object>();
function c1389(): void { say("stored-later/holder-through-a-record/weak-set", (ws1389.add((get1389()) as object), ws1389.has((get1389()) as object))); }

interface R1390 { a1390: number; m1390?: () => number }
function make1390(): R1390 { const r: R1390 = { a1390: 1 }; r.m1390 = () => 1; return r; }
function box1390(): { t: R1390 } { return { t: make1390() }; }
function get1390(): unknown { return box1390().t.m1390; }
const wm1390 = new WeakMap<object, number>();
function c1390(): void { say("stored-later/holder-through-a-record/weak-map", (wm1390.set((get1390()) as object, 1), wm1390.has((get1390()) as object))); }

interface R1391 { a1391: number; m1391?: () => number }
function make1391(): R1391 { const r: R1391 = { a1391: 1 }; r.m1391 = () => 1; return r; }
function box1391(): { t: R1391 } { return { t: make1391() }; }
function get1391(): unknown { return box1391().t.m1391; }
function c1391(): void { say("stored-later/holder-through-a-record/written", ((((get1391())) as any).tag = 1, (((get1391())) as any).tag)); }

interface R1392 { a1392: number; m1392?: () => number }
function make1392(): R1392 { const r: R1392 = { a1392: 1 }; r.m1392 = () => 1; return r; }
function box1392(): { t: R1392 } { return { t: make1392() }; }
function get1392(): unknown { return box1392().t.m1392; }
function c1392(): void { say("stored-later/holder-through-a-record/defined", (Object.defineProperty((get1392()) as object, "t", { value: 1 }), "t" in ((get1392()) as object))); }

interface R1393 { a1393: number; m1393?: () => number }
function make1393(): R1393 { const r: R1393 = { a1393: 1 }; r.m1393 = () => 1; return r; }
function box1393(): { t: R1393 } { return { t: make1393() }; }
function get1393(): unknown { return box1393().t.m1393; }
function c1393(): void { say("stored-later/holder-through-a-record/frozen", (Object.freeze((get1393())), Object.isFrozen((get1393())))); }

interface R1394 { a1394: number; m1394?: () => number }
function make1394(): R1394 { const r: R1394 = { a1394: 1 }; r.m1394 = () => 1; return r; }
function box1394(): { t: R1394 } { return { t: make1394() }; }
function get1394(): unknown { return box1394().t.m1394; }
function c1394(): void { say("stored-later/holder-through-a-record/prototype-set", (Object.setPrototypeOf((get1394()) as object, null), Object.getPrototypeOf((get1394())) === null)); }

interface R1395 { a1395: number; m1395?: () => number }
function make1395(): R1395 { const r: R1395 = { a1395: 1 }; r.m1395 = () => 1; return r; }
function box1395(): { t: R1395 } { return { t: make1395() }; }
function get1395(): unknown { return box1395().t.m1395; }
function c1395(): void { say("stored-later/holder-through-a-record/deleted", (delete (((get1395())) as any).length, Object.hasOwn((get1395()) as object, "length"))); }

interface R1396 { a1396: number; m1396?: () => number }
function make1396(): R1396 { const r: R1396 = { a1396: 1 }; r.m1396 = () => 1; return r; }
function box1396(): { t: R1396 } { return { t: make1396() }; }
function get1396(): unknown { return box1396().t.m1396; }
function same1396(a: unknown, b: unknown): boolean { return a === b; }
function c1396(): void { say("stored-later/holder-through-a-record/in-a-callee", same1396((get1396()), (get1396()))); }

interface R1397 { a1397: number; m1397?: () => number }
function make1397(): R1397 { const r: R1397 = { a1397: 1 }; r.m1397 = () => 1; return r; }
function box1397(): { t: R1397 } { return { t: make1397() }; }
function get1397(): unknown { return box1397().t.m1397; }
function hit1397(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c1397(): void { say("stored-later/holder-through-a-record/switch", hit1397((get1397()), (get1397()))); }

interface R1398 { a1398: number; m1398?: () => number }
function make1398(): R1398 { const r: R1398 = { a1398: 1 }; r.m1398 = () => 1; return r; }
function box1398(): { t: R1398 } { return { t: make1398() }; }
function get1398(): unknown { return box1398().t.m1398; }
let last1398: unknown;
function seen1398(f: unknown): boolean { const same = f === last1398; last1398 = f; return same; }
function c1398(): void { say("stored-later/holder-through-a-record/kept-then-compared", (seen1398((get1398())), seen1398((get1398())))); }

interface R1399 { a1399: number; m1399: () => number }
function make1399(): R1399 { return { a1399: 1, m1399: function () { return 1; } }; }
class K1399 { #f: unknown; constructor() { this.#f = make1399().m1399; } get(): unknown { return this.#f; } }
function c1399(): void { say("function-expression/private-field/strict-eq", (new K1399().get()) === (new K1399().get())); }

interface R1400 { a1400: number; m1400: () => number }
function make1400(): R1400 { return { a1400: 1, m1400: function () { return 1; } }; }
class K1400 { static f: unknown; }
function c1400(): void { say("function-expression/static-field/strict-eq", ((K1400.f = make1400().m1400, K1400.f)) === ((K1400.f = make1400().m1400, K1400.f))); }

interface R1401 { a1401: number; m1401: () => number }
function make1401(): R1401 { return { a1401: 1, m1401: function () { return 1; } }; }
class K1401 { f: unknown = make1401().m1401; }
function c1401(): void { say("function-expression/instance-field/strict-eq", (new K1401().f) === (new K1401().f)); }

interface R1402 { a1402: number; m1402: () => number }
function make1402(): R1402 { return { a1402: 1, m1402: function () { return 1; } }; }
class K1402 { s: unknown; set v(x: unknown) { this.s = x; } }
function get1402(): unknown { const k = new K1402(); k.v = make1402().m1402; return k.s; }
function c1402(): void { say("function-expression/setter/strict-eq", (get1402()) === (get1402())); }

interface R1403 { a1403: number; m1403: () => number }
function make1403(): R1403 { return { a1403: 1, m1403: function () { return 1; } }; }
class B1403 { get(): unknown { return make1403().m1403; } }
class D1403 extends B1403 { get(): unknown { return super.get(); } }
function c1403(): void { say("function-expression/super-method/strict-eq", (new D1403().get()) === (new D1403().get())); }

interface R1404 { a1404: number; m1404: () => number }
function make1404(): R1404 { return { a1404: 1, m1404: function () { return 1; } }; }
class K1404 { constructor(public f: unknown) {} }
function c1404(): void { say("function-expression/constructor-parameter/strict-eq", (new K1404(make1404().m1404).f) === (new K1404(make1404().m1404).f)); }

interface R1405 { a1405: number; m1405: () => number }
function make1405(): R1405 { return { a1405: 1, m1405: function () { return 1; } }; }
function tag1405(_s: TemplateStringsArray, ...xs: unknown[]): unknown { return xs[0]; }
function c1405(): void { say("function-expression/tagged-template/strict-eq", (tag1405`${make1405().m1405}`) === (tag1405`${make1405().m1405}`)); }

interface R1406 { a1406: number; m1406: () => number }
function make1406(): R1406 { return { a1406: 1, m1406: function () { return 1; } }; }
function get1406(x: unknown = make1406().m1406): unknown { return x; }
function c1406(): void { say("function-expression/default-parameter/strict-eq", (get1406()) === (get1406())); }

interface R1407 { a1407: number; m1407: () => number }
function make1407(): R1407 { return { a1407: 1, m1407: function () { return 1; } }; }
function get1407({ f = make1407().m1407 as unknown }: { f?: unknown } = {}): unknown { return f; }
function c1407(): void { say("function-expression/pattern-default/strict-eq", (get1407()) === (get1407())); }

interface R1408 { a1408: number; m1408: () => number }
function make1408(): R1408 { return { a1408: 1, m1408: function () { return 1; } }; }
function get1408(): unknown { const [f] = [make1408().m1408]; return f; }
function c1408(): void { say("function-expression/array-pattern/strict-eq", (get1408()) === (get1408())); }

interface R1409 { a1409: number; m1409: () => number }
function make1409(): R1409 { return { a1409: 1, m1409: function () { return 1; } }; }
function get1409(): unknown { const it = { *[Symbol.iterator](): Generator<unknown> { yield make1409().m1409; } }; for (const f of it) return f; return 0; }
function c1409(): void { say("function-expression/custom-iterable/strict-eq", (get1409()) === (get1409())); }

interface R1410 { a1410: number; m1410: () => number }
function make1410(): R1410 { return { a1410: 1, m1410: function () { return 1; } }; }
function c1410(): void { say("function-expression/map-callback/strict-eq", ([0].map(() => make1410().m1410)[0]) === ([0].map(() => make1410().m1410)[0])); }

interface R1411 { a1411: number; m1411: () => number }
function make1411(): R1411 { return { a1411: 1, m1411: function () { return 1; } }; }
function c1411(): void { say("function-expression/find/strict-eq", ([make1411().m1411].find(() => true)) === ([make1411().m1411].find(() => true))); }

interface R1412 { a1412: number; m1412: () => number }
function make1412(): R1412 { return { a1412: 1, m1412: function () { return 1; } }; }
function c1412(): void { say("function-expression/reduce/strict-eq", ([make1412().m1412 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown)) === ([make1412().m1412 as unknown].reduce((_a: unknown, x: unknown) => x, 0 as unknown))); }

interface R1413 { a1413: number; m1413: () => number }
function make1413(): R1413 { return { a1413: 1, m1413: function () { return 1; } }; }
function c1413(): void { say("function-expression/filter/strict-eq", ([make1413().m1413].filter(() => true)[0]) === ([make1413().m1413].filter(() => true)[0])); }

interface R1414 { a1414: number; m1414: () => number }
function make1414(): R1414 { return { a1414: 1, m1414: function () { return 1; } }; }
function c1414(): void { say("function-expression/flat/strict-eq", ([[make1414().m1414]].flat()[0]) === ([[make1414().m1414]].flat()[0])); }

interface R1415 { a1415: number; m1415: () => number }
function make1415(): R1415 { return { a1415: 1, m1415: function () { return 1; } }; }
function c1415(): void { say("function-expression/at/strict-eq", ([make1415().m1415].at(0)) === ([make1415().m1415].at(0))); }

interface R1416 { a1416: number; m1416: () => number }
function make1416(): R1416 { return { a1416: 1, m1416: function () { return 1; } }; }
function c1416(): void { say("function-expression/pop/strict-eq", ([make1416().m1416].pop()) === ([make1416().m1416].pop())); }

interface R1417 { a1417: number; m1417: () => number }
function make1417(): R1417 { return { a1417: 1, m1417: function () { return 1; } }; }
function c1417(): void { say("function-expression/shift/strict-eq", ([make1417().m1417].shift()) === ([make1417().m1417].shift())); }

interface R1418 { a1418: number; m1418: () => number }
function make1418(): R1418 { return { a1418: 1, m1418: function () { return 1; } }; }
function c1418(): void { say("function-expression/slice/strict-eq", ([make1418().m1418].slice()[0]) === ([make1418().m1418].slice()[0])); }

interface R1419 { a1419: number; m1419: () => number }
function make1419(): R1419 { return { a1419: 1, m1419: function () { return 1; } }; }
function c1419(): void { say("function-expression/concat/strict-eq", (([] as unknown[]).concat([make1419().m1419])[0]) === (([] as unknown[]).concat([make1419().m1419])[0])); }

interface R1420 { a1420: number; m1420: () => number }
function make1420(): R1420 { return { a1420: 1, m1420: function () { return 1; } }; }
function c1420(): void { say("function-expression/spread-array/strict-eq", ([...[make1420().m1420]][0]) === ([...[make1420().m1420]][0])); }

interface R1421 { a1421: number; m1421: () => number }
function make1421(): R1421 { return { a1421: 1, m1421: function () { return 1; } }; }
function c1421(): void { say("function-expression/array-from/strict-eq", (Array.from([make1421().m1421])[0]) === (Array.from([make1421().m1421])[0])); }

interface R1422 { a1422: number; m1422: () => number }
function make1422(): R1422 { return { a1422: 1, m1422: function () { return 1; } }; }
function c1422(): void { say("function-expression/array-of/strict-eq", (Array.of(make1422().m1422)[0]) === (Array.of(make1422().m1422)[0])); }

interface R1423 { a1423: number; m1423: () => number }
function make1423(): R1423 { return { a1423: 1, m1423: function () { return 1; } }; }
function get1423(): unknown { const xs: unknown[] = []; xs.push(make1423().m1423); return xs[0]; }
function c1423(): void { say("function-expression/push-then-read/strict-eq", (get1423()) === (get1423())); }

interface R1424 { a1424: number; m1424: () => number }
function make1424(): R1424 { return { a1424: 1, m1424: function () { return 1; } }; }
function c1424(): void { say("function-expression/set-iteration/strict-eq", ([...new Set([make1424().m1424])][0]) === ([...new Set([make1424().m1424])][0])); }

interface R1425 { a1425: number; m1425: () => number }
function make1425(): R1425 { return { a1425: 1, m1425: function () { return 1; } }; }
function c1425(): void { say("function-expression/map-get/strict-eq", (new Map([[1, make1425().m1425]]).get(1)) === (new Map([[1, make1425().m1425]]).get(1))); }

interface R1426 { a1426: number; m1426: () => number }
function make1426(): R1426 { return { a1426: 1, m1426: function () { return 1; } }; }
function self1426(this: unknown): unknown { return this; }
function c1426(): void { say("function-expression/bind-this/strict-eq", (self1426.bind(make1426().m1426)()) === (self1426.bind(make1426().m1426)())); }

interface R1427 { a1427: number; m1427: () => number }
function make1427(): R1427 { return { a1427: 1, m1427: function () { return 1; } }; }
function self1427(this: unknown): unknown { return this; }
function c1427(): void { say("function-expression/call-this/strict-eq", (self1427.call(make1427().m1427)) === (self1427.call(make1427().m1427))); }

interface R1428 { a1428: number; m1428: () => number }
function make1428(): R1428 { return { a1428: 1, m1428: function () { return 1; } }; }
function first1428(x: unknown): unknown { return x; }
function c1428(): void { say("function-expression/apply-arguments/strict-eq", (first1428.apply(null, [make1428().m1428])) === (first1428.apply(null, [make1428().m1428]))); }

interface R1429 { a1429: number; m1429: () => number }
function make1429(): R1429 { return { a1429: 1, m1429: function () { return 1; } }; }
function first1429(x: unknown): unknown { return x; }
function c1429(): void { say("function-expression/reflect-apply/strict-eq", (Reflect.apply(first1429, null, [make1429().m1429])) === (Reflect.apply(first1429, null, [make1429().m1429]))); }

interface R1430 { a1430: number; m1430: () => number }
function make1430(): R1430 { return { a1430: 1, m1430: function () { return 1; } }; }
function c1430(): void { say("function-expression/logical-or/strict-eq", (((0 as unknown) || make1430().m1430)) === (((0 as unknown) || make1430().m1430))); }

interface R1431 { a1431: number; m1431: () => number }
function make1431(): R1431 { return { a1431: 1, m1431: function () { return 1; } }; }
let none1431: unknown;
function c1431(): void { say("function-expression/nullish/strict-eq", ((none1431 ?? make1431().m1431)) === ((none1431 ?? make1431().m1431))); }

interface R1432 { a1432: number; m1432: () => number }
function make1432(): R1432 { return { a1432: 1, m1432: function () { return 1; } }; }
function c1432(): void { say("function-expression/comma/strict-eq", ((out.length, make1432().m1432)) === ((out.length, make1432().m1432))); }

interface R1433 { a1433: number; m1433: () => number }
function make1433(): R1433 { return { a1433: 1, m1433: function () { return 1; } }; }
function c1433(): void { say("function-expression/computed-member/strict-eq", (({ ["k"]: make1433().m1433 })["k"]) === (({ ["k"]: make1433().m1433 })["k"])); }

interface R1434 { a1434: number; m1434: () => number }
function make1434(): R1434 { return { a1434: 1, m1434: function () { return 1; } }; }
const s1434 = Symbol();
function c1434(): void { say("function-expression/symbol-member/strict-eq", (({ [s1434]: make1434().m1434 })[s1434]) === (({ [s1434]: make1434().m1434 })[s1434])); }

interface R1435 { a1435: number; m1435: () => number }
function make1435(): R1435 { return { a1435: 1, m1435: function () { return 1; } }; }
function c1435(): void { say("function-expression/getter-member/strict-eq", (({ get f(): unknown { return make1435().m1435; } }).f) === (({ get f(): unknown { return make1435().m1435; } }).f)); }

interface R1436 { a1436: number; m1436: () => number }
function make1436(): R1436 { return { a1436: 1, m1436: function () { return 1; } }; }
function c1436(): void { say("function-expression/proxy-get/strict-eq", (new Proxy({ f: make1436().m1436 as unknown }, {}).f) === (new Proxy({ f: make1436().m1436 as unknown }, {}).f)); }

interface R1437 { a1437: number; m1437: () => number }
function make1437(): R1437 { return { a1437: 1, m1437: function () { return 1; } }; }
function c1437(): void { say("function-expression/prototype-chain/strict-eq", (Object.create({ f: make1437().m1437 }).f) === (Object.create({ f: make1437().m1437 }).f)); }

interface R1438 { a1438: number; m1438: () => number }
function make1438(): R1438 { return { a1438: 1, m1438: function () { return 1; } }; }
function c1438(): void { say("function-expression/weak-ref/strict-eq", (new WeakRef(make1438().m1438 as object).deref()) === (new WeakRef(make1438().m1438 as object).deref())); }

interface R1439 { a1439: number; m1439: () => number }
function make1439(): R1439 { return { a1439: 1, m1439: function () { return 1; } }; }
function get1439(_x: unknown): unknown { return arguments[0]; }
function c1439(): void { say("function-expression/arguments-object/strict-eq", (get1439(make1439().m1439)) === (get1439(make1439().m1439))); }

interface R1440 { a1440: number; m1440: () => number }
function make1440(): R1440 { return { a1440: 1, m1440: function () { return 1; } }; }
function get1440(n: number): unknown { return n === 0 ? make1440().m1440 : get1440(n - 1); }
function c1440(): void { say("function-expression/recursion/strict-eq", (get1440(2)) === (get1440(2))); }

c1381(); c1382(); c1383(); c1384(); c1385(); c1386(); c1387(); c1388(); c1389(); c1390(); c1391(); c1392(); c1393(); c1394(); c1395(); c1396(); c1397(); c1398(); c1399(); c1400(); c1401(); c1402(); c1403(); c1404(); c1405(); c1406(); c1407(); c1408(); c1409(); c1410(); c1411(); c1412(); c1413(); c1414(); c1415(); c1416(); c1417(); c1418(); c1419(); c1420(); c1421(); c1422(); c1423(); c1424(); c1425(); c1426(); c1427(); c1428(); c1429(); c1430(); c1431(); c1432(); c1433(); c1434(); c1435(); c1436(); c1437(); c1438(); c1439(); c1440();
console.log(out.join("\n"));
