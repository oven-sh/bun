// answers: without-library
// # the method is read, then an operand runs code, then the call is made: a call by value. Its stub looks at the receiver: as made now, so as made at the read. Whatever the operand does to the receiver, what was READ is what is called
// # f10 = tell, f11 = twice, f1 = gather, f2 = fill, f3 = keep, f4 = once, f5 = keysOf, f6 = probe, f7 = run
// # RUN(PUSHED): bytes f1:Body mechanisms=all-Inlining
// # where the receiver's class is proven the read is a look at the receiver alone, and the stub of the call fetches the method that was left unread if the operand has changed the receiver since
// # PUSHED: CallMethodThatMayBeUnread.ArrayPush
// # RUN(SET): bytes f2:Body mechanisms=all-Inlining
// # SET: CallMethodOfProvenBuiltinClassByValue.MapSet
// # RUN(ADDED): bytes f3:Body mechanisms=all-Inlining
// # ADDED: CallMethodThatMayBeUnread.SetAdd
// # RUN(ONCE): bytes f4:Body mechanisms=all-Inlining
// # where the class is expected and not proven the read is a look too: it asks the class besides; what it finds as made stays unread, anything else is read there, in front of the operand
// # ONCE: ReadMethodAtSiteUnlessReceiverFindsIt.ArrayPush
// # ONCE: CallMethodOfAnyReceiverThatMayBeUnread.ArrayPush
// # RUN(PROBED): bytes f6:Body mechanisms=all-Inlining
// # PROBED: CallMethodOfBuiltinClassByValue.RegExpTest
// # LIBRARY: own
// # At the end the shell runs the same text itself: every answer is the same.
// # RUN: run-in-shell $SHELL
// # CHECK: 70 of 70 of 70
// # CHECK-NEXT: exited with 0
declare function report(value: unknown): void;
function tell(f: () => unknown) { try { report(f()); } catch (e) { report((e as Error).name); } }
function twice(x: number): number { return x * 2; }
// The list leaves the program, so nobody can say that it stays as its class makes it: else the method is called without a look at the receiver (receivers-that-stay-as-made-by-the-site-1).
function gather(from: number[], f: (x: number) => number): number[] { const result: number[] = []; (globalThis as any).gatheredInThisTest = result; for (let i = 0; i < from.length; i++) result.push(f(from[i])); return result; }
function fill(table: Map<string, number>, names: string[], f: (name: string) => number): number { for (let i = 0; i < names.length; i++) table.set(names[i], f(names[i])); return table.size; }
function keep(seen: Set<number>, from: number[], f: (x: number) => number): number { for (let i = 0; i < from.length; i++) seen.add(f(from[i])); return seen.size; }
function once(list: number[], f: () => number): number { const length = list.push(f()); return length + 0; }
function keysOf(table: Map<string, number>): string { let keys = ""; table.forEach((value, key) => { keys += key + ","; }); return keys; }
let fs: ((x: number) => number)[] = [twice, x => x + 1, x => -x];
tell(() => gather([1, 2, 3], fs[0]).join());
tell(() => gather([1, 2, 3], fs[1]).join());
tell(() => gather([], fs[2]).join());
tell(() => fill(new Map(), ["a", "b", "a"], name => name.length));
// The set has left the program, so nobody can say that it stays as its class makes it: else no operand can do anything to it and the method is called without a look at the receiver (instances-that-stay-as-made-1).
const handedOut = new Set<number>();
(globalThis as any).handedOutOfThisTest = handedOut;
tell(() => keep(handedOut, [1, 2, 1, 3], fs[2]));
const list: number[] = [];
tell(() => once(list, () => 7));
tell(() => once(list, () => 8));
tell(() => list.join());
const kept = Array.prototype.push;
tell(() => once(list, () => { (list as any).push = function (v: number) { return "mine:" + v; }; return 9; }));
tell(() => list.join());
tell(() => once(list, () => 10));
tell(() => list.join());
delete (list as any).push;
tell(() => once(list, () => 11));
tell(() => list.join());
const other: number[] = [1];
tell(() => once(other, () => { Object.setPrototypeOf(other, { push() { return "below"; }, join: Array.prototype.join }); return 2; }));
tell(() => Array.prototype.join.call(other));
tell(() => once(other, () => 3));
tell(() => Array.prototype.join.call(other));
const frozen: number[] = [1];
tell(() => once(frozen, () => { Object.freeze(frozen); return 2; }));
tell(() => frozen.join());
const sealed: number[] = [1];
tell(() => once(sealed, () => { Object.preventExtensions(sealed); return 2; }));
tell(() => sealed.join());
let order = "";
const watched: number[] = [];
Object.defineProperty(watched, "push", { configurable: true, get() { order += "r"; return kept; } });
tell(() => once(watched, () => { order += "o"; return 5; }));
tell(() => order + ":" + watched.join());
const short: number[] = [1, 2, 3];
tell(() => once(short, () => { short.length = 0; return 4; }));
tell(() => short.join());
const holed: number[] = [];
tell(() => once(holed, () => { holed[5] = 1; return 2; }));
tell(() => holed.length + ":" + holed.join());
const mixed: any[] = [1];
tell(() => once(mixed, () => { mixed.push("text", 1.5, {}); return 2; }));
tell(() => mixed.length);
const table = new Map<string, number>();
tell(() => fill(table, ["x", "y"], name => { (table as any).set = function () { return "mine"; }; return 1; }));
tell(() => table.size + ":" + keysOf(table));
tell(() => fill(table, ["z"], () => 2));
tell(() => table.size);
delete (table as any).set;
tell(() => fill(table, ["z"], () => 3));
tell(() => table.size + ":" + table.get("z"));
tell(() => once(null as any, () => 1));
tell(() => once(undefined as any, () => { report("never"); return 1; }));
tell(() => once({ push: (v: number) => "an object's own: " + v } as any, () => 6));
tell(() => once("text" as any, () => 6));
function probe(x: any, f: () => unknown): string { const answer = x.test(f()); return "" + answer; }
function run(x: any, f: () => unknown): string { const answer = x.exec(f()); return "" + answer; }
class Comparator { test(range: unknown): boolean { return range instanceof Range; } exec(range: unknown): string { return "ran " + (range instanceof Range); } }
class Range { test(comparator: unknown): boolean { return comparator instanceof Comparator; } }
tell(() => probe(new Comparator(), () => new Range()));
tell(() => probe(new Range(), () => new Range()));
tell(() => probe({ test: (v: unknown) => "own:" + v }, () => 1));
tell(() => probe(/a+/, () => "caab"));
tell(() => probe(/a+/, () => "b"));
tell(() => probe({}, () => 1));
tell(() => probe({ test: 5 }, () => 1));
tell(() => probe("text", () => 1));
tell(() => probe(7, () => 1));
tell(() => probe([1], () => 1));
tell(() => probe(new Map(), () => 1));
tell(() => probe(null, () => 1));
tell(() => run(new Comparator(), () => new Range()));
tell(() => run(/(a)(b)?/, () => "xab"));
tell(() => run({}, () => 1));
const sticky = /a/y;
tell(() => probe(sticky, () => { sticky.lastIndex = 1; return "ba"; }));
tell(() => sticky.lastIndex);
const touched = /a/;
(touched as any).test = function (v: unknown) { return "touched:" + v; };
tell(() => probe(touched, () => "a"));
function look(x: any, f: () => unknown): string { const answer = x.get(f()); return "" + answer; }
tell(() => look(new Map([["k", 1]]), () => "k"));
tell(() => look(new WeakMap(), () => ({})));
tell(() => look({ get: (k: unknown) => "own:" + k }, () => "k"));
tell(() => look({}, () => "k"));
tell(() => look(new Set(), () => "k"));
tell(() => look("text", () => "k"));
function cut(x: any, f: () => number): string { const answer = x.slice(f()); return "" + answer; }
tell(() => cut([1, 2, 3], () => 1));
tell(() => cut("text", () => 1));
tell(() => cut({ slice: (k: unknown) => "own:" + k }, () => 1));
tell(() => cut(new Uint8Array([1, 2, 3]), () => 1));
tell(() => cut({}, () => 1));
report("end");
