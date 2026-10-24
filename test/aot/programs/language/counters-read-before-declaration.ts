// Counters of closures that functions declared above them can read before `var count = 0` has run: `undefined`, then NaN, then integers; used as keys. `keyed` casts its counter, a number, to `string`: where types are tested the cast throws a TypeError, and with types erased the number is the key.
declare const console: { log(...values: unknown[]): void };
function show(value: unknown): string { return typeof value === "number" && Object.is(value, -0) ? "-0" : String(value); }
function attempt(run: () => unknown): string { try { return show(run()); } catch (error) { return (error as Error).constructor.name; } }
function makeStack() {
    const api = { push, pop, top, find, size, at, put, jump, double, half, shrink, keyed };
    early.push(show(api.top()), show(api.size()), show(api.find("a")), show(api.at()), show(api.keyed()));
    var items: (string | undefined)[] = [];
    var named: Record<string, string | undefined> = { NaN: "named NaN", undefined: "named undefined", Infinity: "named Infinity", "-1": "named -1", "9007199254740992": "named 2^53", "1e+21": "named 1e21" };
    var count = 0;
    var cursor = 0;
    var ratio = 0;
    function push(item: string): number { items[count] = item; count++; return count; }
    function pop(): string | undefined { count--; const item = items[count]; items[count] = undefined; return item; }
    function top(): string | undefined { return items === undefined ? "no items yet" : items[count - 1]; }
    function find(item: string): number { for (let i = count - 1; i >= 0; i--) { if (items[i] === item) return i; } return -1; }
    function size(): number | undefined { return count; }
    function at(): string | undefined { return items === undefined ? "no items yet" : items[cursor]; }
    function put(item: string): void { items[cursor] = item; }
    function jump(by: number): number { cursor = cursor + (by | 0); return cursor; }
    function double(): number { cursor = cursor + cursor; return cursor; }
    function half(): string | undefined { ratio = ratio + 0.5; return items[ratio]; }
    function shrink(): number { cursor = cursor - cursor; return cursor; }
    function keyed(): string | undefined { return named === undefined ? "no names yet" : named[cursor as unknown as string]; }
    return api;
}
const early: string[] = [];
const stack = makeStack();
console.log(early.join(" | "));
console.log(stack.push("a"), stack.push("b"), stack.push("c"), show(stack.top()), stack.find("a"), stack.find("c"), stack.find("z"), stack.size());
console.log(show(stack.pop()), show(stack.pop()), show(stack.top()), stack.size(), show(stack.pop()), show(stack.pop()), stack.size(), show(stack.top()), stack.find("a"), stack.push("d"), stack.size());
console.log(show(stack.at()), stack.jump(1), show(stack.at()), stack.jump(-2), show(stack.at()), attempt(() => stack.keyed()), stack.jump(1), show(stack.at()));
stack.jump(5); stack.put("far"); console.log(show(stack.at()), stack.jump(-5), show(stack.at()));
console.log(show(stack.half()), show(stack.half()), show(stack.half()));
stack.jump(1);
let doubled = 0; for (let i = 0; i < 1100; i++) { doubled = stack.double(); if (i === 52 || i === 62 || i === 63 || i === 69 || i === 1022 || i === 1023) console.log(i, show(doubled), show(stack.at()), attempt(() => stack.keyed())); }
console.log(show(stack.shrink()), show(stack.at()), attempt(() => stack.keyed()), show(stack.jump(1)), show(stack.at()));
function makeEarly() {
    const bump = () => { seen++; return seen; };
    const read = () => list[seen];
    const list: (string | undefined)[] = ["zero", "one", "two"];
    const before = [show(bump()), show(read()), show(bump())];
    var seen = 0;
    return [...before, show(read()), show(bump()), show(read()), show(bump()), show(read()), show(bump()), show(read())].join(" ");
}
console.log(makeEarly());
