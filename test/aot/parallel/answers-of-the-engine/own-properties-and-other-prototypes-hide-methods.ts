// A list, a map or a set finds the methods of its class only while it is as its class makes it. An own property, a definition by a descriptor, another prototype, none at all and a class below each hide them, on an object that comes from elsewhere and on one that was made here.
// Under: --aot-testing=WritesBodiesStraight: the closed ways give the same answers
(globalThis as any).report = (value: unknown) => { console.log(typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value)); };
declare function report(value: unknown): void;
function attempt(way: () => unknown) { try { return way(); } catch (error: any) { return error.name; } }
function pushTo(list: number[], value: number) { return list.push(value); }
function popOf(list: number[]) { return list.pop(); }
function pushMany(list: number[], count: number) { let last: any = 0; for (let i = 0; i < count; i++) last = list.push(i); return last; }
function whereIs(list: number[], value: number) { return list.indexOf(value); }
function joined(list: number[]) { return list.join("+"); }
function getFrom(map: Map<string, number>, key: string) { return map.get(key); }
function hasIn(set: Set<number>, value: number) { return set.has(value); }
function sizeOf(map: Map<string, number>) { return map.size; }
const ordinary = [1];
const own: any = [1];
own.push = function (value: number) { return "own:" + value; };
own.indexOf = () => "own index";
class Stack extends Array<number> { push(value: number): any { return "below:" + super.push(value); } }
const otherPrototype: any = [1];
Object.setPrototypeOf(otherPrototype, { push() { return "other prototype"; }, pop() { return "other pop"; }, indexOf() { return "other index"; }, join() { return "other join"; } });
const noPrototype: any = [1];
Object.setPrototypeOf(noPrototype, null);
const defined: any = [1];
Object.defineProperty(defined, "push", { get() { return () => "from a getter"; } });
const frozen: any = Object.freeze([1]);
const lists: any[] = [ordinary, own, new Stack(), otherPrototype, noPrototype, defined, frozen, { push() { return "no list"; }, pop() { return "no pop"; }, indexOf() { return "no index"; }, join() { return "no join"; } }];
for (let l = 0; l < lists.length; l++) { report(attempt(() => pushTo(lists[l], 2))); report(attempt(() => pushMany(lists[l], 3))); report(attempt(() => whereIs(lists[l], 1))); report(attempt(() => joined(lists[l]))); report(attempt(() => popOf(lists[l]))); }
function freshWithOwn() { const list: any = []; list.push = () => "own on a new list"; return list.push(1); }
function freshWithOtherPrototype() { const list: any = [1]; Object.setPrototypeOf(list, { push() { return "other above a new list"; } }); return list.push(1); }
function freshWithDefinition() { const list: any = []; Object.defineProperty(list, "push", { value: () => "defined on a new list" }); return list.push(1); }
function freshUnderComputedKey(key: string) { const list: any = []; list[key] = () => "under a key"; return list.push(1); }
function freshAssigned() { const list: any = []; Object.assign(list, { push() { return "assigned"; } }); return list.push(1); }
function freshInLoop(count: number) { const list: any = []; let last: any; for (let i = 0; i < count; i++) { last = list.push(i); if (i === 1) list.push = () => "own from the second turn on"; } return last; }
function freshOrdinary() { const list: number[] = []; list.push(4); list.push(5); return list.length + list.join(); }
report(freshWithOwn());
report(freshWithOtherPrototype());
report(freshWithDefinition());
report(freshUnderComputedKey("push"));
report(freshUnderComputedKey("other"));
report(freshAssigned());
report(freshInLoop(2));
report(freshInLoop(4));
report(freshOrdinary());
const map = new Map([["a", 1]]);
const mapWithOwn: any = new Map([["a", 1]]);
mapWithOwn.get = () => "own get";
class Table extends Map<string, number> { get(key: string): any { return "below:" + super.get(key); } get size(): any { return "many"; } }
const mapBelowOther: any = new Map([["a", 1]]);
Object.setPrototypeOf(mapBelowOther, { get() { return "other get"; }, size: "other size" });
const maps: any[] = [map, mapWithOwn, new Table([["a", 1]]), mapBelowOther, { get() { return "no map"; }, size: -1 }];
for (let m = 0; m < maps.length; m++) { report(getFrom(maps[m], "a")); report(getFrom(maps[m], "b")); report(sizeOf(maps[m])); }
const set = new Set([1]);
const setWithOwn: any = new Set([1]);
setWithOwn.has = () => "own has";
report(hasIn(set, 1));
report(hasIn(set, 2));
report(hasIn(setWithOwn, 1));
report(attempt(() => Map.prototype.get.call(set, 1)));
report(attempt(() => Array.prototype.push.call(undefined, 1)));
report(Array.prototype.push.call({ length: 3 }, 1));
report("end");
