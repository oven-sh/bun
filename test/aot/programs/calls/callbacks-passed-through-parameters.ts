// A function that calls one of its parameters, and hands it on to itself, is given every kind of function value.
interface Item { id: number; label: string; next: Item | undefined }
const items: Item[] = [];
for (let i = 0; i < 6; i++) items.push({ id: i, label: "item" + i, next: undefined });
for (let i = 0; i + 1 < items.length; i++) items[i].next = items[i + 1];
const first = items[0];
const lines: string[] = [];
function attempt(label: string, run: () => unknown): void {
    try {
        lines.push(label + ": " + String(run()));
    } catch (error) {
        lines.push(label + " throws " + (error as Error).constructor.name);
    }
}

function countIf(item: Item | undefined, test: (item: Item) => boolean): number {
    if (item === undefined) return 0;
    return (test(item) ? 1 : 0) + countIf(item.next, test);
}
function sumOf(item: Item | undefined, weigh: (item: Item, depth: number) => number, depth: number): number {
    if (item === undefined) return 0;
    return weigh(item, depth) + sumOf(item.next, weigh, depth + 1);
}
function labelsOf(item: Item | undefined, labelOf: (item: Item) => string): string {
    if (item === undefined) return "";
    return labelOf(item) + "," + labelsOf(item.next, labelOf);
}
function findFirst(item: Item | undefined, pick: (item: Item) => Item | undefined): Item | undefined {
    if (item === undefined) return undefined;
    return pick(item) ?? findFirst(item.next, pick);
}
function visitAll(item: Item | undefined, visit: (item: Item) => void): void {
    if (item === undefined) return;
    visit(item);
    visitAll(item.next, visit);
}
function visitIfGiven(item: Item | undefined, visit?: (item: Item) => void): number {
    if (item === undefined) return 0;
    if (visit) visit(item);
    return 1 + visitIfGiven(item.next, visit);
}
function describeCallback(item: Item | undefined, test: (item: Item) => boolean, expected: unknown): string {
    if (item === undefined) return "";
    return [test === expected, typeof test, test.name, test.length, test(item)].join("/") + ";" + describeCallback(item.next?.next?.next, test, expected);
}

function isEven(item: Item): boolean { return item.id % 2 === 0; }
function isLate(item: Item, after = 3): boolean { return item.id > after; }
function hasAny(...all: Item[]): boolean { return all.length > 0 && all[0].id > 1; }
function usesArguments(): boolean { return arguments.length === 1 && (arguments[0] as Item).id < 2; }
function usesThis(this: unknown, item: Item): boolean { return this === undefined && item.id === 5; }

let limit = 2;
attempt("a literal with a capture", () => countIf(first, item => item.id > limit));
limit = 4;
attempt("the capture is read anew", () => countIf(first, item => item.id > limit));
attempt("a declared function", () => countIf(first, isEven));
attempt("a default parameter", () => countIf(first, isLate));
attempt("a rest parameter", () => countIf(first, hasAny));
attempt("the arguments object", () => countIf(first, usesArguments));
attempt("this is undefined", () => countIf(first, usesThis));
attempt("no parameters", () => countIf(first, () => true));
attempt("a bound function", () => countIf(first, isLate.bind(undefined)));
attempt("a function bound to an argument", () => countIf(first, ((after: number, item: Item) => item.id > after).bind(undefined, 1)));
attempt("a proxy", () => countIf(first, new Proxy(isEven, {})));
attempt("a proxy with a trap", () => countIf(first, new Proxy(isEven, { apply: (target, self, args) => !target(args[0]) })));
attempt("a function of the engine", () => countIf(first, Boolean as unknown as (item: Item) => boolean));
attempt("a class", () => countIf(first, class { } as unknown as (item: Item) => boolean));
for (const value of [undefined, null, 7, {}, "text"] as unknown[])
    attempt("what is no function: " + String(value), () => countIf(first, value as (item: Item) => boolean));
attempt("an async function", () => countIf(first, (async () => false) as unknown as (item: Item) => boolean));
attempt("a generator function", () => countIf(first, (function* () { }) as unknown as (item: Item) => boolean));

attempt("numbers both ways", () => sumOf(first, (item, depth) => item.id * 10 + depth, 0));
attempt("fractions", () => sumOf(first, (item, depth) => item.id / 4 + depth / 2, 0.5));
attempt("the second parameter is ignored", () => sumOf(first, item => item.id, 0));
attempt("Math.max", () => sumOf(first, Math.max as unknown as (item: Item, depth: number) => number, 0));
attempt("strings", () => labelsOf(first, item => item.label));
attempt("a declared function that yields a string", () => labelsOf(first, function upper(item: Item) { return item.label.toUpperCase(); }));
attempt("an object or undefined", () => findFirst(first, item => item.id === 3 ? item : undefined)?.label);
attempt("never found", () => findFirst(first, () => undefined));
let visited = "";
attempt("nothing is yielded", () => { visitAll(first, item => { visited += item.id; }); return visited; });
attempt("what is yielded is not looked at", () => { visitAll(first, (item => item.label) as (item: Item) => void); return "done"; });
attempt("an optional callback that is given", () => { let n = 0; return visitIfGiven(first, () => { n++; }) + n; });
attempt("an optional callback that is left out", () => visitIfGiven(first));

attempt("a result of another kind", () => countIf(first, ((item: Item) => item.id) as unknown as (item: Item) => boolean));

attempt("the same function inside", () => describeCallback(first, isEven, isEven));
const tagged = Object.assign((item: Item) => item.id === 0, { tag: "t" });
attempt("a function with a property", () => describeCallback(first, tagged, tagged) + tagged.tag);
const literal = (item: Item) => item.id === 3;
attempt("a literal in a constant", () => describeCallback(first, literal, literal));

attempt("a callback that throws", () => countIf(first, item => { if (item.id === 2) throw new RangeError("at " + item.id); return true; }));
attempt("a callback that calls the function again", () => countIf(first, outer => countIf(first, inner => inner.id < outer.id) > 2));
const holder = { get test() { return isEven; }, field: isLate };
attempt("from a getter", () => countIf(first, holder.test));
attempt("from a field", () => countIf(first, holder.field));
const chosen = [isEven, isLate, (item: Item) => item.id === 1];
attempt("from an array", () => chosen.map(test => countIf(first, test)).join());
attempt("one of two", () => [0, 1].map(which => countIf(first, which ? isEven : item => item.id > 0)).join());

const maybeVisitors: Array<((item: Item) => void) | undefined> = [undefined, item => { visited += "!" + item.id; }];
attempt("an optional callback nobody knows, left out", () => visitIfGiven(first, maybeVisitors[0]));
attempt("an optional callback nobody knows, given", () => { visited = ""; return visitIfGiven(first, maybeVisitors[1]) + visited; });
function kindOfCallback(item: Item | undefined, callback: unknown): string {
    if (item === undefined) return "";
    return typeof callback + (typeof callback === "function" ? String((callback as (item: Item) => unknown)(item)) : "-") + kindOfCallback(item.next?.next, callback);
}
attempt("typeof a literal", () => kindOfCallback(first, (item: Item) => item.id));
for (const value of [isEven, undefined, null, 5, "s", {}, Math.abs] as unknown[])
    attempt("typeof " + String(typeof value), () => kindOfCallback(first, value));

const numbers = [3, 1, 2];
const noNumbers: number[] = [];
for (const bad of [undefined, null, 5, "s", {}] as unknown[]) {
    attempt("map with " + String(bad), () => numbers.map(bad as (n: number) => number).join());
    attempt("map of nothing with " + String(bad), () => noNumbers.map(bad as (n: number) => number).join());
    attempt("forEach with " + String(bad), () => numbers.forEach(bad as (n: number) => void));
    attempt("filter of nothing with " + String(bad), () => noNumbers.filter(bad as (n: number) => boolean).join());
    attempt("sort with " + String(bad), () => numbers.slice().sort(bad as (a: number, b: number) => number).join());
}
const unknownMappers: Array<(n: number, index: number, all: number[]) => unknown> = [n => n * 2, (n, index) => n + index, (n, index, all) => all.length + n, Math.sqrt, String, function (this: unknown, n) { return typeof this + n; }];
for (const mapper of unknownMappers)
    attempt("map with a function nobody knows", () => numbers.map(mapper).join());
attempt("map with this", () => numbers.map(function (this: { add: number }, n) { return n + this.add; }, { add: 10 }).join());
attempt("forEach with this", () => { let out = ""; numbers.forEach(function (this: string[], n) { out += this[n - 1]; }, ["a", "b", "c"]); return out; });
attempt("an arrow ignores this", () => numbers.map(n => n + 1, { add: 10 }).join());
attempt("filter, some, every, find, reduce", () => [numbers.filter(n => n > 1).join(), numbers.some(n => n > 2), numbers.every(n => n > 2), numbers.find(n => n < 3), numbers.reduce((sum, n) => sum + n, 0)].join(" "));
attempt("sort with a comparator", () => numbers.slice().sort((a, b) => b - a).join());

function twice(item: Item, change: (item: Item) => number): number { return change(item) + change(item.next ?? item); }
function withIndex(item: Item, change: (item: Item, index: number) => number): number { return change(item, 1) + (item.next ? withIndex(item.next, change) : 0); }
const shared = (item: Item) => item.id + 1;
attempt("one function for two helpers", () => twice(first, shared) + withIndex(first, shared) + (shared === shared ? 1 : 0) + shared(first));
function keep(item: Item, kept: Array<(item: Item) => number>, change: (item: Item) => number): number { kept.push(change); return change(item); }
const keptCallbacks: Array<(item: Item) => number> = [];
attempt("a helper that keeps its callback", () => keep(first, keptCallbacks, item => item.id + 7) + keptCallbacks[0](items[1]) + (keptCallbacks[0] === keptCallbacks[0] ? 1 : 0));
function applyTo(item: Item, outer: (item: Item, inner: (item: Item) => number) => number): number { return outer(item, other => other.id + 100) + (item.next ? applyTo(item.next, outer) : 0); }
attempt("a callback that takes a callback", () => applyTo(first, (item, inner) => inner(item) + 1));
attempt("closures made in a loop", () => { let total = 0; for (let round = 0; round < 50; round++) total += countIf(first, item => item.id > round % 6); return total; });
attempt("a callback that allocates", () => { const made: string[][] = []; for (let round = 0; round < 2000; round++) visitAll(first, item => { made.push([item.label + round]); if (made.length > 64) made.length = 0; }); return made.length; });

let timesFinally = 0;
function guarded(item: Item | undefined, run: (item: Item) => number): string {
    if (item === undefined) return "";
    let out: string;
    try {
        out = String(run(item));
    } catch (error) {
        out = "caught " + (error as Error).constructor.name;
    } finally {
        timesFinally++;
    }
    return out + ";" + guarded(item.next, run);
}
attempt("caught inside the helper", () => guarded(first, item => { if (item.id % 2) throw new RangeError("odd"); return item.id; }) + timesFinally);
function guardedLoosely(item: Item | undefined, run: any): string {
    if (item === undefined) return "";
    let out: string;
    try {
        out = String(run(item));
    } catch (error) {
        out = "caught " + (error as Error).constructor.name;
    }
    return out + ";" + guardedLoosely(item.next, run);
}
attempt("undefined is called inside try", () => guardedLoosely(first, undefined));
attempt("null is called inside try", () => guardedLoosely(first, null));
attempt("a literal is called inside try", () => guardedLoosely(first, (item: Item) => item.id * 3));
function calledLoosely(item: Item | undefined, run: any): number {
    if (item === undefined) return 0;
    return run(item) + calledLoosely(item.next, run);
}
attempt("undefined is called", () => calledLoosely(first, undefined));
attempt("null is called", () => calledLoosely(first, null));
attempt("a literal is called", () => calledLoosely(first, (item: Item) => item.id + 1));
function lastOf(item: Item, pick: (item: Item) => string): string {
    if (item.next === undefined) return pick(item);
    return lastOf(item.next, pick);
}
attempt("called in tail position", () => lastOf(first, item => item.label + "!"));
attempt("throws in tail position", () => lastOf(first, item => { throw new EvalError(item.label); }));
function describeFunction(item: Item | undefined, f: (item: Item) => unknown): string {
    if (item === undefined) return "";
    return f.name + f.length + String(f(item)) + " " + describeFunction(item.next?.next?.next, f);
}
attempt("name and length of a literal", () => describeFunction(first, item => item.id));
attempt("name and length of a declared function", () => describeFunction(first, isEven));
const listeners = new Map<(item: Item) => void, number>();
function listen(item: Item | undefined, listener: (item: Item) => void): number {
    if (item === undefined) return listeners.size;
    listeners.set(listener, item.id);
    listener(item);
    return listen(item.next, listener);
}
attempt("a key of a map", () => { let heard = 0; const listener = (item: Item) => { heard += item.id; }; const size = listen(first, listener); return size + " " + heard + " " + listeners.get(listener) + " " + listeners.delete(listener) + " " + listeners.size; });
class Made { constructor(public id: number) {} }
function construct(item: Item | undefined, make: new (id: number) => Made): number {
    if (item === undefined) return 0;
    return new make(item.id).id + construct(item.next, make);
}
attempt("constructed", () => construct(first, Made));
const owner = { prefix: "<", describe(this: { prefix: string } | undefined, item: Item): string { return (this === undefined ? "?" : this.prefix) + item.id; } };
function callOn(item: Item | undefined, target: { prefix: string }, f: (this: { prefix: string }, item: Item) => string): string {
    if (item === undefined) return "";
    return f.call(target, item) + callOn(item.next, target, f);
}
attempt("a method taken off its object", () => labelsOf(first, owner.describe as (item: Item) => string));
attempt("call with this", () => callOn(first, { prefix: ">" }, owner.describe));
attempt("call with this and a function expression", () => callOn(first, { prefix: "#" }, function (item) { return this.prefix + item.label; }));
attempt("call with this and an arrow", () => callOn(first, { prefix: "#" }, item => item.label));

let depth = 0;
function descend(item: Item, again: (item: Item) => number): number { depth++; return again(item) + 1; }
function forever(item: Item): number { return descend(item, forever); }
attempt("endless recursion through a callback", () => { try { return forever(first); } catch (error) { return (error instanceof RangeError) + " " + (depth > 1000); } });
console.log(lines.join("\n"));
