// answers: without-library
// # under a name that a class of the engine answers to, the stub asks the receiver whether it is of that class and as the class makes it; any other receiver is served as before
// # f1 = got, f3 = pushed, f4 = had: nothing is known of the receiver, and the site is the one of a call by name: the stub of the first class that answers to the name is what it calls
// # RUN(GOT): bytes f1:Body mechanisms=all
// # GOT: CallMethodOfBuiltinClassAtSite.MapGet
// # RUN(PUSHED): bytes f3:Body mechanisms=all-Inlining
// # PUSHED: CallMethodOfBuiltinClassAtSite.ArrayPush
// # RUN(HAD): bytes f4:Body mechanisms=all
// # HAD: CallMethodOfBuiltinClassAtSite.MapHas
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 78 of 78 of 78
// # CHECK-NEXT: exited with 0
let calls = 0;
function got(table: any, key: any) { const found = table.get(key); calls++; return found; }
function put(table: any, key: any, value: any) { table.set(key, value); calls++; return table.size; }
function had(table: any, key: any) { const answer = table.has(key); calls++; return answer; }
function pushed(list: any, value: any) { const length = list.push(value); calls++; return length; }
function added(set: any, value: any) { set.add(value); calls++; return set.size; }
function cut(text: any, from: any, to: any) { const part = text.slice(from, to); calls++; return String(part); }
function found(text: any, part: any) { const place = text.indexOf(part); calls++; return place; }
function held(text: any, part: any) { const answer = text.includes(part); calls++; return answer; }
function dropped(table: any, key: any) { const answer = table.delete(key); calls++; return answer; }
function tried(f: () => unknown) { try { return String(f()); } catch (e) { return e instanceof TypeError ? "TypeError" : "another error"; } }
class Doubled extends Map<string, number> { get(key: string) { return (super.get(key) ?? 0) * 2; } }
class Counted extends Array<number> { push(value: number) { return super.push(value) + 100; } }
class Shelf { items: string[] = []; size = -1; get(key: string) { return "shelf " + key; } set(key: string, value: string) { this.items.push(key + "=" + value); return this; } has(key: string) { return key === "x"; } push(value: string) { return "shelf takes " + value; } add(value: string) { this.items.push(value); } slice(from: number, to: number) { return from + ".." + to; } indexOf(part: string) { return "nowhere " + part; } }
const record = { size: -2, get: (key: string) => "record " + key, set: (key: string) => key, has: () => "always", push: (value: number) => "record takes " + value, add: () => 0, slice: () => "a slice", indexOf: () => "an index" };
const plain = new Map<any, any>();
const shelf = new Shelf();
report(put(plain, "a", 1));
report(put(shelf, "a", "1"));
report(put(record, "a", 1));
report(put(plain, "b", 2));
report(got(plain, "a"));
report(got(shelf, "a"));
report(got(record, "a"));
report(got(plain, "missing"));
report(had(plain, "b"));
report(had(shelf, "x"));
report(had(record, "x"));
report(had(new Set(["b"]), "b"));
report(had(new Set(["b"]), "c"));
const key = {};
const weak = new WeakMap<object, number>([[key, 7]]);
report(got(weak, key));
report(had(weak, key));
report(had(weak, {}));
report(tried(() => put(weak, "no object", 1)));
const withOwnMethod = new Map<string, number>([["a", 1]]);
report(got(withOwnMethod, "a"));
(withOwnMethod as any).get = (key: string) => key + "!";
report(got(withOwnMethod, "a"));
(withOwnMethod as any).set = function (key: string) { return key; };
report(put(withOwnMethod, "z", 9));
delete (withOwnMethod as any).get;
report(got(withOwnMethod, "a"));
report(got(new Doubled([["a", 21]]), "a"));
const below = new Map<string, number>([["a", 5]]);
Object.setPrototypeOf(below, { get(key: string) { return "below " + key; }, has() { return "always"; } });
report(got(below, "a"));
report(had(below, "a"));
report(tried(() => put(below, "a", 1)));
report(tried(() => got(null, "k")));
report(tried(() => got(undefined, "k")));
report(tried(() => got(5, "k")));
report(tried(() => got("text", "k")));
report(tried(() => got({}, "k")));
report(got(new Map<any, number>([[1, 10], ["1", 20]]), 1));
report(got(new Map<any, number>([[NaN, 10]]), NaN));
report(got(new Map<any, number>([[0, 10]]), -0));
const list: number[] = [];
report(pushed(list, 4));
report(pushed(shelf, "a book"));
report(pushed(record, 5));
report(pushed(list, 5));
report(list.join());
const withOwnPush: number[] = [1];
(withOwnPush as any).push = (value: number) => "own " + value;
report(pushed(withOwnPush, 2));
report(withOwnPush.length);
const counted = new Counted();
report(pushed(counted, 3));
report(counted.length);
const frozen = Object.freeze([1]);
report(tried(() => pushed(frozen, 2)));
report(frozen.length);
const holey: number[] = [];
holey[3] = 1;
report(pushed(holey, 2));
report(pushed([0.5], 1));
report(pushed(["a"], 1));
report(tried(() => pushed("text", 1)));
const set = new Set<string>();
report(added(set, "a"));
report(added(shelf, "b"));
report(added(record, "b"));
report(added(set, "a"));
(set as any).add = () => 0;
report(added(set, "c"));
report(cut("abcdef", 1, 3));
report(cut([1, 2, 3, 4], 1, 3));
report(cut(shelf, 1, 3));
report(cut(record, 1, 3));
report(cut("abcdef", -2, undefined));
report(found("abcdef", "cd"));
report(found([1, 2, 3], 3));
report(found(shelf, "cd"));
report(found(record, "cd"));
report(found("abc", "x"));
report(held("abcdef", "cd"));
report(held([1, 2, 3], 3));
report(held([1, 2, 3], 4));
report(held(["a", "b"], "b"));
report(held({ includes: () => "a record" }, 1));
report(dropped(new Map([["a", 1]]), "a"));
report(dropped(new Map([["a", 1]]), "b"));
report(dropped(new Set(["a"]), "a"));
report(dropped(new Set(["a"]), "b"));
report(dropped({ delete: () => "a record" }, 1));
report(had(new WeakSet([key]), key));
report(had(new WeakSet([key]), {}));
report(put(new WeakMap(), key, 1));
report(calls);
report("end");
