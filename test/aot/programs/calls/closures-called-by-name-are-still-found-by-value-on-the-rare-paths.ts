// Every closure here is called by name on the usual path, so its entry for calls by value looks unused. Each is also reached by value some rarer way: in the untyped copy of a function whose argument did not fit, through call, apply, bind and Reflect.apply, as an accessor, by a protocol of the language, as a callback of a built-in, out of a table that is too large to test for.
const log: string[] = [];
const say = (...parts: unknown[]) => void log.push(parts.join(" "));

// The typed version names `twice`. The argument that does not fit sends the call to the untyped copy, which has the closure as a value only.
interface Job { run: (n: number) => number; times: number }
function twice(n: number): number { return n * 2; }
function perform(job: Job, start: number): number {
  let result = start;
  for (let i = 0; i < job.times; i++) result = job.run(result);
  return result;
}
say("fits", perform({ run: twice, times: 3 }, 1));
try {
  say("does not fit", perform({ run: twice, times: "2" } as any, 5));
} catch (error) {
  say("does not fit", (error as Error).constructor.name);
}
try {
  say("start does not fit", (perform as any)({ run: twice, times: 2 }, "7"));
} catch (error) {
  say("start does not fit", (error as Error).constructor.name);
}

function add(this: { base: number } | void, a: number, b: number): number { return (this ? this.base : 0) + a + b; }
say("by name", add(1, 2));
say("call", add.call({ base: 10 }, 1, 2), "apply", add.apply({ base: 20 }, [1, 2]), "Reflect.apply", Reflect.apply(add, { base: 30 }, [1, 2]));
const bound = add.bind({ base: 40 }, 1);
say("bind", bound(2), bound.name, bound.length);

function readSize(this: { items: number[] }): number { return this.items.length; }
const bag = { items: [1, 2, 3] };
say("by name", readSize.call(bag));
Object.defineProperty(bag, "size", { get: readSize, configurable: true });
say("accessor", (bag as any).size, Object.getOwnPropertyDescriptor(bag, "size")!.get === readSize);

function describe(this: { id: number }): string { return "#" + this.id; }
function weigh(this: { id: number }): number { return this.id * 100; }
function* walk(this: { id: number }) { yield this.id; yield this.id + 1; }
function toJSON(this: { id: number }) { return { json: this.id }; }
const thing = { id: 7, toString: describe, valueOf: weigh, [Symbol.iterator]: walk, toJSON };
say("by name", describe.call(thing), weigh.call(thing), [...walk.call(thing)].join(), toJSON.call(thing).json);
say("protocols", `${thing}`, +thing, (thing as any) + 1, [...thing].join(), JSON.stringify(thing), String(thing));

function descending(a: number, b: number): number { return b - a; }
function shout(match: string): string { return match.toUpperCase(); }
function isOdd(n: number): boolean { return n % 2 === 1; }
say("by name", descending(1, 2), shout("a"), isOdd(3));
say("callbacks", [3, 1, 2].sort(descending).join(), "abcabc".replace(/b/g, shout), [1, 2, 3, 4, 5].filter(isOdd).join(), Array.from([1, 2, 3], isOdd).join(), new Map([[1, 2]]).forEach(descending));

function settle(this: void, resolve: (value: number) => void) { resolve(42); }
function later(value: number) { say("then", value); return value + 1; }
settle(value => say("by name", value));
later(0);
say("awaited", await new Promise(settle).then(later), await { then: settle });
await new Promise<void>(done => queueMicrotask(function tick() { say("microtask"); done(); }));

const table: ((n: number) => number)[] = [
  n => n + 1, n => n + 2, n => n + 3, n => n + 4, n => n + 5, n => n + 6, n => n + 7, n => n + 8, n => n + 9, n => n + 10,
  n => n + 11, n => n + 12, n => n + 13, n => n + 14, n => n + 15, n => n + 16, n => n + 17, n => n + 18, n => n + 19, n => n + 20,
];
let total = table[0](0) + table[19](0);
for (let i = 0; i < table.length * 3; i++) total += table[(i * 7) % table.length](i);
say("table", total);

function tag(strings: TemplateStringsArray, ...values: number[]): string { return strings.raw.join("|") + values.join(); }
say("tag", tag`a${1}b${2}c`, tag(Object.assign(["x"], { raw: ["x"] }) as any));

function chosen(flag: boolean) { return flag ? twice : isOdd; }
say("chosen", chosen(true)(4), chosen(false)(4), chosen(log.length > 3) === twice, [twice, isOdd].indexOf(chosen(false) as any));
console.log(log.join("\n"));
