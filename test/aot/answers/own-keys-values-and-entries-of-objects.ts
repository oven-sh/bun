// answers: with-library
// # the lists of own keys, values and entries: of objects made here, stored into, deleted from; and of a written layout, on objects that got their keys in another order, have more or fewer, hide one, answer through getters that delete or add a later key, through a proxy, and on what is no object
// # each list and each pair is a new one, which the program may write into. The built-in goes by what is called, under another name too, and a local named Object is none
// # f1 = show, f2 = keysInSight, f3 = valuesInSight, f4 = entriesInSight, f5 = storedLater, f6 = deleted, f7 = changed, f8 = fresh, f9 = pairsAreFresh, f10 = empty, f11 = values, f12 = entries, f13 = keys, f14 = inLoop, f15 = renamed, f16 = shadowed, f17 = noArgument, f18 = twoArguments, f19 = tell
// # RUN(SIGHT): walk f3 mechanisms=all
// # REQUIRES(SIGHT): entries-of-bun
// # SIGHT-NOT: overload=ObjectValues
// # RUN(FORM): walk f11 mechanisms=all
// # REQUIRES(FORM): entries-of-bun
// # FORM-LABEL: code f11:Body
// # FORM: = HasKeyOrder
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # REQUIRES: entries-of-bun
// # CHECK: 125 of 125 of 125
// # CHECK-NEXT: exited with 0
// # RUN(ALSO1): run-in-shell mechanisms=-Guesses-ParameterGuards $SHELL
// # REQUIRES(ALSO1): entries-of-bun
// # ALSO1: 125 of 125 of 125
// # ALSO1-NEXT: exited with 0
// # RUN(ALSO2): run-in-shell mechanisms=-EscapeAnalysis $SHELL
// # REQUIRES(ALSO2): entries-of-bun
// # ALSO2: 125 of 125 of 125
// # ALSO2-NEXT: exited with 0
// # RUN(ALSO3): run-in-shell mechanisms=-BuiltinCalls $SHELL
// # REQUIRES(ALSO3): entries-of-bun
// # ALSO3: 125 of 125 of 125
// # ALSO3-NEXT: exited with 0
declare function report(value: unknown): void;
type Point = { x: number; y: number };
function show(list: any) { let s = ""; for (let i = 0; i < list.length; i++) s += (i ? "," : "") + String(list[i]); return list.length + ":" + s; }
function keysInSight(i: unknown) { const o = { a: i, b: 1 }; return show(Object.keys(o)); }
function valuesInSight(i: unknown) { const o = { a: i, b: 1 }; return show(Object.values(o)); }
function entriesInSight(i: unknown) { const o = { a: i, b: 1 }; const e = Object.entries(o); return e.length + ":" + show(e[0]) + ";" + show(e[1]); }
function storedLater(i: unknown) { const o: any = { a: i, b: 1 }; o.c = 2; return show(Object.keys(o)) + "|" + show(Object.values(o)); }
function deleted(i: unknown) { const o: any = { a: i, b: 1 }; delete o.a; return show(Object.keys(o)) + "|" + show(Object.values(o)); }
function changed(i: unknown) { const o = { a: i, b: 1 }; o.b = 5; return show(Object.values(o)); }
function fresh(i: unknown) { const o = { a: i, b: 1 }; const first = Object.values(o); const second = Object.values(o); first[0] = "w"; first.push("more"); return (first !== second) + ":" + show(first) + ":" + show(second) + ":" + String(o.a); }
function pairsAreFresh(i: unknown) { const o = { a: i, b: 1 }; const e: any = Object.entries(o); e[0][1] = "w"; return show(e[0]) + ":" + String(o.a) + ":" + (e[0] !== e[1]) + ":" + Array.isArray(e[1]); }
function empty() { const o = {}; return show(Object.keys(o)) + show(Object.values(o)) + show(Object.entries(o)); }
function values(p: Point) { return show(Object.values(p)); }
function entries(p: Point) { const e = Object.entries(p); let s = ""; for (let i = 0; i < e.length; i++) s += show(e[i]) + ";"; return Array.isArray(e) + ":" + s; }
function keys(p: Point) { return show(Object.keys(p)); }
function inLoop(points: Point[]) { let s = ""; for (let i = 0; i < points.length; i++) s += show(Object.values(points[i])) + show(Object.keys(points[i])) + ";"; return s; }
function renamed(p: Point) { const list = Object.values; return show(list(p)); }
function shadowed(p: Point) { const Object = { values(q: Point) { return [q.y]; } }; return show(Object.values(p)); }
function noArgument() { return show((Object.values as any)()); }
function twoArguments(p: Point) { return show((Object.values as any)(p, 5)) + show((Object.keys as any)(p, p)); }
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
class P { x = 1; y = 2; }
class Q extends P { z = 3; }
let log = "";
const extra: any = { x: 1, y: 2 };
extra.z = 3;
const again: any = { x: 1, y: 2 };
delete again.x;
again.x = 9;
const deleting: any = { get x() { delete deleting.y; return 1; }, y: 2 };
const adding: any = { get x() { adding.z = 3; return 1; }, y: 2 };
const hidden = Object.defineProperty({ x: 1, y: 2 }, "y", { enumerable: false });
const redefined = Object.defineProperty({ x: 1, y: 2 }, "x", { get() { log += "g"; return 8; }, enumerable: true });
const trapped = new Proxy({ x: 1, y: 2 }, { ownKeys() { log += "o"; return ["y", "x"]; }, get(target: any, key) { log += "r"; return target[key] * 10; } });
const hostile: any[] = [{ x: 1, y: 2 }, { y: 2, x: 1 }, { x: "a", y: undefined }, extra, again, { x: 1, get y() { return 7; } }, deleting, adding, hidden, redefined, trapped];
hostile.push({ x: 1, y: 2, [Symbol("s")]: 3 }, { x: 1, y: 2, 0: "zero" }, Object.freeze({ x: 1, y: 2 }), new P(), new Q(), Object.create({ x: 1, y: 2 }), JSON.parse('{"x":1,"__proto__":2,"y":3}'));
hostile.push({ x: 1 }, {}, [4, 5], "ab", 5, true, null, undefined, function f() {});
tell(() => keysInSight(1));
tell(() => valuesInSight("v"));
tell(() => valuesInSight(undefined));
tell(() => entriesInSight(null));
tell(() => storedLater(1));
tell(() => deleted(1));
tell(() => changed(1));
tell(() => fresh(1));
tell(() => pairsAreFresh(1));
tell(() => empty());
for (let i = 0; i < hostile.length; i++) tell(() => values(hostile[i]));
for (let i = 0; i < hostile.length; i++) tell(() => entries(hostile[i]));
for (let i = 0; i < hostile.length; i++) tell(() => keys(hostile[i]));
for (let i = 0; i < hostile.length; i++) tell(() => inLoop([{ x: 3, y: 4 }, hostile[i], { x: 5, y: 6 }]));
tell(() => renamed({ x: 1, y: 2 }));
tell(() => renamed(again));
tell(() => shadowed({ x: 1, y: 2 }));
tell(() => noArgument());
tell(() => twoArguments({ x: 1, y: 2 }));
report(log);
report("end");
