// Generated program: object and closure identity stays observable when allocations are removed (second series, part 24).
declare const console: any;
const out: string[] = [];
function say(name: string, value: unknown): void { out.push(name + "=" + String(value)); }

interface R1441 { a1441: number; m1441: () => number }
function make1441(): R1441 { return { a1441: 1, m1441: function () { return 1; } }; }
function even1441(n: number): unknown { return n === 0 ? make1441().m1441 : odd1441(n - 1); }
function odd1441(n: number): unknown { return even1441(n - 1); }
function c1441(): void { say("function-expression/mutual-recursion/strict-eq", (even1441(2)) === (even1441(2))); }

interface R1442 { a1442: number; m1442: () => number }
function make1442(): R1442 { return { a1442: 1, m1442: function () { return 1; } }; }
function again1442(): R1442 { return make1442(); }
function c1442(): void { say("function-expression/maker-forwarded/strict-eq", (again1442().m1442) === (again1442().m1442)); }

interface R1443 { a1443: number; m1443: () => number }
function make1443(): R1443 { return { a1443: 1, m1443: function () { return 1; } }; }
function again1443(): R1443 { return make1443(); }
function get1443(): unknown { return again1443().m1443; }
function c1443(): void { say("function-expression/maker-forwarded-and-returned/strict-eq", (get1443()) === (get1443())); }

interface R1444 { a1444: number; m1444: () => number }
function make1444(): R1444 { return { a1444: 1, m1444: function () { return 1; } }; }
function build1444(f: () => R1444): R1444 { return f(); }
function c1444(): void { say("function-expression/maker-as-a-callback/strict-eq", (build1444(make1444).m1444) === (build1444(make1444).m1444)); }

interface R1445 { a1445: number; m1445: () => number }
function make1445(): R1445 { return { a1445: 1, m1445: function () { return 1; } }; }
function build1445(f: () => R1445): R1445 { return f(); }
function get1445(): unknown { return build1445(make1445).m1445; }
function c1445(): void { say("function-expression/maker-as-a-callback-returned/strict-eq", (get1445()) === (get1445())); }

interface R1446 { a1446: number; m1446: () => number }
function make1446(): R1446 { return { a1446: 1, m1446: function () { return 1; } }; }
function box1446(): { t: R1446 } { return { t: make1446() }; }
function get1446(): unknown { return box1446().t.m1446; }
function c1446(): void { say("function-expression/holder-through-a-record/strict-eq", (get1446()) === (get1446())); }

interface R1447 { a1447: number; m1447: () => number }
function make1447(): R1447 { return { a1447: 1, m1447: function () { return 1; } }; }
function box1447(): Array<R1447> { return [make1447()]; }
function get1447(): unknown { return box1447()[0].m1447; }
function c1447(): void { say("function-expression/holder-through-an-array/strict-eq", (get1447()) === (get1447())); }

interface R1448 { a1448: number; m1448: () => number }
function make1448(): R1448 { return { a1448: 1, m1448: function () { return 1; } }; }
function box1448(): () => R1448 { const t = make1448(); return () => t; }
function get1448(): unknown { return box1448()().m1448; }
function c1448(): void { say("function-expression/holder-through-a-closure/strict-eq", (get1448()) === (get1448())); }

interface R1449 { a1449: number; m1449: () => number }
function make1449(): R1449 { return { a1449: 1, m1449: function () { return 1; } }; }
function get1449(): unknown { try { return make1449().m1449; } finally { out.length; } }
function c1449(): void { say("function-expression/finally/strict-eq", (get1449()) === (get1449())); }

interface R1450 { a1450: number; m1450: () => number }
function make1450(): R1450 { return { a1450: 1, m1450: function () { return 1; } }; }
function get1450(n: number): unknown { switch (n) { case 1: return make1450().m1450; default: return 0; } }
function c1450(): void { say("function-expression/switch-arm/strict-eq", (get1450(1)) === (get1450(1))); }

interface R1451 { a1451: number; m1451: () => number }
function make1451(): R1451 { return { a1451: 1, m1451: function () { return 1; } }; }
function c1451(): void { say("function-expression/object-from-entries/strict-eq", (Object.fromEntries([["k", make1451().m1451]]).k) === (Object.fromEntries([["k", make1451().m1451]]).k)); }

interface R1452 { a1452: number; m1452: () => number }
function make1452(): R1452 { return { a1452: 1, m1452: function () { return 1; } }; }
function get1452(): unknown { const t = make1452(); const u = { t, n: 1 }; const v = { u }; return v.u.t.m1452; }
function c1452(): void { say("function-expression/structured-holder/strict-eq", (get1452()) === (get1452())); }

interface R1453 { a1453: number; m1453: () => number }
function make1453(): R1453 { return { a1453: 1, m1453: function () { return 1; } }; }
function box1453(): { t: R1453 } { return { t: make1453() }; }
function get1453(): unknown { return box1453().t.m1453; }
function c1453(): void { say("function-expression/holder-through-a-record/strict-ne", (get1453()) !== (get1453())); }

interface R1454 { a1454: number; m1454: () => number }
function make1454(): R1454 { return { a1454: 1, m1454: function () { return 1; } }; }
function box1454(): { t: R1454 } { return { t: make1454() }; }
function get1454(): unknown { return box1454().t.m1454; }
function c1454(): void { say("function-expression/holder-through-a-record/loose-eq", (get1454()) == (get1454())); }

interface R1455 { a1455: number; m1455: () => number }
function make1455(): R1455 { return { a1455: 1, m1455: function () { return 1; } }; }
function box1455(): { t: R1455 } { return { t: make1455() }; }
function get1455(): unknown { return box1455().t.m1455; }
function c1455(): void { say("function-expression/holder-through-a-record/object-is", Object.is((get1455()), (get1455()))); }

interface R1456 { a1456: number; m1456: () => number }
function make1456(): R1456 { return { a1456: 1, m1456: function () { return 1; } }; }
function box1456(): { t: R1456 } { return { t: make1456() }; }
function get1456(): unknown { return box1456().t.m1456; }
function c1456(): void { say("function-expression/holder-through-a-record/set", new Set([(get1456()), (get1456())]).size); }

interface R1457 { a1457: number; m1457: () => number }
function make1457(): R1457 { return { a1457: 1, m1457: function () { return 1; } }; }
function box1457(): { t: R1457 } { return { t: make1457() }; }
function get1457(): unknown { return box1457().t.m1457; }
function c1457(): void { say("function-expression/holder-through-a-record/map-key", new Map([[(get1457()), 1], [(get1457()), 2]]).size); }

interface R1458 { a1458: number; m1458: () => number }
function make1458(): R1458 { return { a1458: 1, m1458: function () { return 1; } }; }
function box1458(): { t: R1458 } { return { t: make1458() }; }
function get1458(): unknown { return box1458().t.m1458; }
function c1458(): void { say("function-expression/holder-through-a-record/includes", [(get1458())].includes((get1458()))); }

interface R1459 { a1459: number; m1459: () => number }
function make1459(): R1459 { return { a1459: 1, m1459: function () { return 1; } }; }
function box1459(): { t: R1459 } { return { t: make1459() }; }
function get1459(): unknown { return box1459().t.m1459; }
function c1459(): void { say("function-expression/holder-through-a-record/index-of", [(get1459())].indexOf((get1459()))); }

interface R1460 { a1460: number; m1460: () => number }
function make1460(): R1460 { return { a1460: 1, m1460: function () { return 1; } }; }
function box1460(): { t: R1460 } { return { t: make1460() }; }
function get1460(): unknown { return box1460().t.m1460; }
const ws1460 = new WeakSet<object>();
function c1460(): void { say("function-expression/holder-through-a-record/weak-set", (ws1460.add((get1460()) as object), ws1460.has((get1460()) as object))); }

interface R1461 { a1461: number; m1461: () => number }
function make1461(): R1461 { return { a1461: 1, m1461: function () { return 1; } }; }
function box1461(): { t: R1461 } { return { t: make1461() }; }
function get1461(): unknown { return box1461().t.m1461; }
const wm1461 = new WeakMap<object, number>();
function c1461(): void { say("function-expression/holder-through-a-record/weak-map", (wm1461.set((get1461()) as object, 1), wm1461.has((get1461()) as object))); }

interface R1462 { a1462: number; m1462: () => number }
function make1462(): R1462 { return { a1462: 1, m1462: function () { return 1; } }; }
function box1462(): { t: R1462 } { return { t: make1462() }; }
function get1462(): unknown { return box1462().t.m1462; }
function c1462(): void { say("function-expression/holder-through-a-record/written", ((((get1462())) as any).tag = 1, (((get1462())) as any).tag)); }

interface R1463 { a1463: number; m1463: () => number }
function make1463(): R1463 { return { a1463: 1, m1463: function () { return 1; } }; }
function box1463(): { t: R1463 } { return { t: make1463() }; }
function get1463(): unknown { return box1463().t.m1463; }
function c1463(): void { say("function-expression/holder-through-a-record/defined", (Object.defineProperty((get1463()) as object, "t", { value: 1 }), "t" in ((get1463()) as object))); }

interface R1464 { a1464: number; m1464: () => number }
function make1464(): R1464 { return { a1464: 1, m1464: function () { return 1; } }; }
function box1464(): { t: R1464 } { return { t: make1464() }; }
function get1464(): unknown { return box1464().t.m1464; }
function c1464(): void { say("function-expression/holder-through-a-record/frozen", (Object.freeze((get1464())), Object.isFrozen((get1464())))); }

interface R1465 { a1465: number; m1465: () => number }
function make1465(): R1465 { return { a1465: 1, m1465: function () { return 1; } }; }
function box1465(): { t: R1465 } { return { t: make1465() }; }
function get1465(): unknown { return box1465().t.m1465; }
function c1465(): void { say("function-expression/holder-through-a-record/prototype-set", (Object.setPrototypeOf((get1465()) as object, null), Object.getPrototypeOf((get1465())) === null)); }

interface R1466 { a1466: number; m1466: () => number }
function make1466(): R1466 { return { a1466: 1, m1466: function () { return 1; } }; }
function box1466(): { t: R1466 } { return { t: make1466() }; }
function get1466(): unknown { return box1466().t.m1466; }
function c1466(): void { say("function-expression/holder-through-a-record/deleted", (delete (((get1466())) as any).length, Object.hasOwn((get1466()) as object, "length"))); }

interface R1467 { a1467: number; m1467: () => number }
function make1467(): R1467 { return { a1467: 1, m1467: function () { return 1; } }; }
function box1467(): { t: R1467 } { return { t: make1467() }; }
function get1467(): unknown { return box1467().t.m1467; }
function same1467(a: unknown, b: unknown): boolean { return a === b; }
function c1467(): void { say("function-expression/holder-through-a-record/in-a-callee", same1467((get1467()), (get1467()))); }

interface R1468 { a1468: number; m1468: () => number }
function make1468(): R1468 { return { a1468: 1, m1468: function () { return 1; } }; }
function box1468(): { t: R1468 } { return { t: make1468() }; }
function get1468(): unknown { return box1468().t.m1468; }
function hit1468(a: unknown, b: unknown): boolean { switch (a) { case b: return true; } return false; }
function c1468(): void { say("function-expression/holder-through-a-record/switch", hit1468((get1468()), (get1468()))); }

interface R1469 { a1469: number; m1469: () => number }
function make1469(): R1469 { return { a1469: 1, m1469: function () { return 1; } }; }
function box1469(): { t: R1469 } { return { t: make1469() }; }
function get1469(): unknown { return box1469().t.m1469; }
let last1469: unknown;
function seen1469(f: unknown): boolean { const same = f === last1469; last1469 = f; return same; }
function c1469(): void { say("function-expression/holder-through-a-record/kept-then-compared", (seen1469((get1469())), seen1469((get1469())))); }

c1441(); c1442(); c1443(); c1444(); c1445(); c1446(); c1447(); c1448(); c1449(); c1450(); c1451(); c1452(); c1453(); c1454(); c1455(); c1456(); c1457(); c1458(); c1459(); c1460(); c1461(); c1462(); c1463(); c1464(); c1465(); c1466(); c1467(); c1468(); c1469();
console.log(out.join("\n"));
