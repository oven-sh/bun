// A spread and a pattern over a value of which nothing is known are one operation of the run time each. It takes a shorter road by what the value is, where nobody can see the difference: lists, sets, maps, their iterators fresh and half used, texts, typed arrays, arguments; and the protocol for classes below with an iteration of their own, an own @@iterator or next, a moved prototype, getters, a proxy, iterables that log, throw and have to be closed.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
function show(list: any): string { let s = ""; for (let i = 0; i < list.length; i++) s += (i in list ? (Array.isArray(list[i]) ? "[" + list[i].join("|") + "]" : String(list[i])) : "hole") + ","; return s; }
function spread(items: any): string { return show([...items]); }
function behind(items: any): string { return show([0, ...items, 9]); }
function twice(items: any): string { return show([...items, ...items]); }
function passed(items: any): string { return count(...items); }
function count(...values: any[]): string { return values.length + ":" + show(values); }
function two(items: any): string { const [a, b] = items; return String(a) + "/" + String(b); }
function none(items: any): string { const [] = items; return "none"; }
function all(items: any): string { return spread(items) + " " + behind(items) + " " + passed(items) + " " + two(items) + " " + none(items); }
function attempt(run: () => unknown): void { try { report(run()); } catch (error: any) { report(error instanceof TypeError ? "TypeError" : String(error)); } }
report(all([1, 2, 3]));
report(all([]));
report(all([1.5, 2.5]));
report(all(["a", { toString() { return "o"; } }]));
report(all([1, , 3]));
report(all([, ,]));
report(all(new Array(3)));
report(all(Object.freeze([1, 2])));
const sparse: any[] = [];
sparse[70000] = 1;
report([...sparse].length + "," + two(sparse));
const withGetter: any[] = [1, 2, 3];
Object.defineProperty(withGetter, 1, { get() { withGetter.push(withGetter.length * 10); return "g"; } });
report(spread(withGetter));
report(two(withGetter));
report(withGetter.length);
const named: any = [1, 2];
named.extra = 5;
report(all(named));
const set = new Set<any>([3, 1, "x", 1]);
const map = new Map<any, any>([["a", 1], ["b", 2], [3, "c"]]);
report(all(set));
report(all(map));
report(all(new Set()));
report(all(new Map()));
report(all(map.keys()));
report(all(map.values()));
report(all(map.entries()));
report(all(set.values()));
report(all(set.keys()));
report(all(set.entries()));
report(all([5, 6, 7].values()));
report(all([5, 6, 7].keys()));
report(all([5, 6, 7].entries()));
report(all("ab😀c"));
report(all(""));
report(all("\ud83d😀"));
report(all("ab".repeat(3) + String(12)));
report(all(new String("ob")));
report(all("xyz"[Symbol.iterator]()));
report(all(new Uint8Array([7, 8, 9])));
report(all(new Float64Array([1.5, NaN, -0])));
report(all(new BigInt64Array([1n, -2n])));
report(all(new Uint8Array([7, 8, 9]).values()));
report(all((function (..._: any[]) { return arguments; })(1, 2, 3)));
report(all((function (a: any, b: any) { "use strict"; a = 9; return arguments; })(1, 2)));
report(all((function (a: any, b: any) { a = 9; return arguments; }).call(null, 1, 2)));
function* generate(n: number): any { for (let i = 0; i < n; i++) yield i; }
report(spread(generate(3)) + two(generate(3)) + passed(generate(2)));
const partly = map.keys();
partly.next();
report(spread(partly));
report(spread(partly));
const partlySet = set.values();
partlySet.next();
report(two(partlySet));
report(spread(partlySet));
const partlyList = [1, 2, 3, 4].values();
partlyList.next();
report(two(partlyList));
report(spread(partlyList));
const partlyText = "abcd"[Symbol.iterator]();
partlyText.next();
report(two(partlyText));
report(spread(partlyText));
const shrinking = new Map<number, number>();
for (let i = 0; i < 40; i++) shrinking.set(i, i * i);
for (let i = 0; i < 35; i++) shrinking.delete(i);
report(all(shrinking));
report(all(shrinking.values()));
shrinking.clear();
report(all(shrinking));
shrinking.set(1, 1);
report(all(shrinking.keys()));
const keysOfChanged = map.keys();
keysOfChanged.next();
map.delete("b");
map.set("z", 26);
report(spread(keysOfChanged));
map.delete("z");
map.set("b", 2);
const large = new Set<number>();
for (let i = 0; i < 1000; i++) large.add(i * 3);
report([...large].length + "," + [...large][999] + "," + [...large.values()].reduce((a, b) => a + b, 0));
class Evens extends Array<number> { *[Symbol.iterator](): any { for (let i = 0; i < this.length; i += 2) yield this[i]; } }
const evens = new Evens();
evens.push(1, 2, 3, 4, 5);
report(all(evens));
class Plain extends Array<number> {}
const plain = new Plain();
plain.push(1, 2);
report(all(plain));
class Sorted extends Set<number> { *[Symbol.iterator](): any { yield* [...super.values()].sort((a, b) => a - b); } }
report(all(new Sorted([3, 1, 2])));
class Keyed extends Map<string, number> { [Symbol.iterator](): any { return super.keys(); } }
report(all(new Keyed([["k", 1], ["l", 2]])));
class PlainSet extends Set<number> {}
report(all(new PlainSet([4, 5])));
const ownList: any = [1, 2, 3];
ownList[Symbol.iterator] = function* () { yield "own"; };
report(all(ownList));
const ownSet: any = new Set([1]);
ownSet[Symbol.iterator] = function* () { yield 70; yield 71; };
report(all(ownSet));
const ownMap: any = new Map([[1, 1]]);
ownMap[Symbol.iterator] = function* () { yield "m"; };
report(all(ownMap));
const ownNext: any = map.keys();
ownNext.next = function () { return { done: true, value: undefined }; };
report(all(ownNext));
const ownNextOfList: any = [1, 2].values();
let calls = 0;
ownNextOfList.next = function () { return calls++ < 2 ? { done: false, value: "n" + calls } : { done: true }; };
report(spread(ownNextOfList));
const ownIterator: any = set.values();
ownIterator[Symbol.iterator] = function () { return [8, 9][Symbol.iterator](); };
report(all(ownIterator));
const moved: any = [1, 2];
Object.setPrototypeOf(moved, { [Symbol.iterator]: function* () { yield "moved"; } });
report(spread(moved) + two(moved));
const movedSet: any = new Set([1, 2]);
Object.setPrototypeOf(movedSet, { [Symbol.iterator]: function* () { yield "moved"; } });
report(spread(movedSet) + two(movedSet));
let log = "";
function closable(values: any[]): any { let i = 0; return { [Symbol.iterator]() { log += "o"; return this; }, next() { log += "n"; return i < values.length ? { done: false, value: values[i++] } : { done: true, value: undefined }; }, return() { log += "r"; return {}; } }; }
report(all(closable([1, 2, 3])));
report(log);
log = "";
report(two(closable([1])) + two(closable([1, 2])) + none(closable([1])));
report(log);
const getters = { [Symbol.iterator]() { return { get next() { log += "N"; return () => ({ get done() { log += "d"; return false; }, get value() { log += "v"; return 1; } }); }, get return() { log += "R"; return undefined; } }; } };
log = "";
report(two(getters));
report(log);
attempt(() => two({ [Symbol.iterator]() { return { next() { return { done: false, value: 1 }; }, return() { return 5; } }; } }));
attempt(() => two({ [Symbol.iterator]() { return { next() { throw new RangeError("next"); }, return() { log += "!"; return {}; } }; } }));
attempt(() => spread({ [Symbol.iterator]() { return { next() { throw new RangeError("next"); } }; } }));
attempt(() => spread({ [Symbol.iterator]() { return { next() { return 5; } }; } }));
attempt(() => two({ [Symbol.iterator]() { return { next() { return 5; } }; } }));
attempt(() => spread({ [Symbol.iterator]() { return 5; } }));
attempt(() => two({ [Symbol.iterator]() { return 5; } }));
attempt(() => spread({ [Symbol.iterator]() { return {}; } }));
attempt(() => two({ [Symbol.iterator]() { return {}; } }));
attempt(() => none({ [Symbol.iterator]() { return {}; } }));
attempt(() => spread({}));
attempt(() => two({}));
attempt(() => spread(5));
attempt(() => two(5));
attempt(() => spread(undefined));
attempt(() => two(null));
attempt(() => spread({ [Symbol.iterator]: 5 }));
const proxied = new Proxy([1, 2, 3], { get(target: any, key: any, receiver: any) { if (typeof key === "string") log += key + ";"; return Reflect.get(target, key, receiver); } });
log = "";
report(spread(proxied) + two(proxied));
report(log);
const detached = new Uint8Array([1, 2, 3]);
(detached.buffer as any).transfer();
attempt(() => spread(detached));
attempt(() => two(detached));
const mutating = { list: [1, 2, 3], [Symbol.iterator]() { const list = this.list; let i = 0; return { next() { if (i === 1) list.push(4); return i < list.length ? { done: false, value: list[i++] } : { done: true, value: undefined }; } }; } };
report(spread(mutating));
report("end");
