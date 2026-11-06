// `list.push(...other)` and its two older spellings: what the list holds afterwards and what the call answers, for every kind of list on either side.
const seen: string[] = [];
const show = (value: unknown): string => Array.isArray(value) ? "[" + Array.from(value, show).join() + "]#" + value.length : typeof value === "string" ? JSON.stringify(value) : Object.is(value, -0) ? "-0" : String(value);
const say = (name: string, run: () => unknown) => {
  try { seen.push(name + ": " + show(run())); } catch (error) { seen.push(name + " threw " + (error as Error).constructor.name + " " + String((error as Error).message)); }
};

function spread<T>(target: T[], source: T[]): number { return target.push(...source); }
function apply<T>(target: T[], source: T[]): number { return target.push.apply(target, source); }
function prototypeApply<T>(target: T[], source: T[]): number { return Array.prototype.push.apply(target, source); }
function notLast(target: number[], source: number[]): number { const length = target.push(...source); return length * 10 + target.length; }
function ignored(target: number[], source: number[]): number[] { target.push(...source); return target; }
function withOthers(target: unknown[], source: unknown[]): number { return target.push("first", ...source, "last"); }
function twice(target: unknown[], source: unknown[]): number { return target.push(...source, ...source); }
function fresh(i: number, source: number[]): number { const made: number[] = [i & 7]; made.push(...source); return made.length + made[2]; }
function inTry(target: number[], source: number[]): string { try { return "length " + target.push(...source); } catch (error) { return "caught " + (error as Error).constructor.name; } }

const forms: [string, (target: any[], source: any[]) => number][] = [["spread", spread], ["apply", apply], ["prototype", prototypeApply]];
const holes = [1, , 3] as number[];
const grown: number[] = []; grown[2] = 5;
for (let round = 0; round < 3; round++) {
  for (const [name, push] of forms) {
    const both = (target: any[], source: any[]) => { const answer = push(target, source); return [answer, target, source]; };
    say(name + " integers", () => both([1], [4, 5, 6]));
    say(name + " onto none", () => both([], [4, 5, 6]));
    say(name + " none", () => both([1, 2], []));
    say(name + " none onto none", () => both([], []));
    say(name + " doubles", () => both([0.5], [1.5, 2.5]));
    say(name + " doubles onto integers", () => both([1, 2], [1.5, -0, NaN]));
    say(name + " integers onto doubles", () => both([0.5], [1, 2]));
    say(name + " texts onto integers", () => both([1, 2], ["a", "b"]));
    say(name + " texts onto doubles", () => both([0.5], ["a", undefined, null]));
    say(name + " integers onto texts", () => both(["a"], [1, 2]));
    say(name + " doubles onto texts", () => both(["a"], [1.5, NaN, -0]));
    say(name + " objects", () => both([{ toString() { return "one"; } }], [[1], [2, [3]]]));
    say(name + " holes", () => both([0], holes));
    say(name + " holes of doubles", () => both([0.5], [1.5, , 2.5]));
    say(name + " grown", () => both(["a"], grown));
    say(name + " onto holes", () => both([1, , 3], [4]));
    say(name + " made with a length", () => both(new Array(2), new Array(2)));
    say(name + " itself", () => { const list = [1, 2, 3]; return [push(list, list), list]; });
    say(name + " itself, texts", () => { const list = ["a", "b"]; push(list, list); return [push(list, list), list]; });
    say(name + " a hundred", () => { const list: number[] = []; const source = Array.from({ length: 100 }, (_, index) => index); push(list, source); return [push(list, source), list[0], list[99], list[100], list[199]]; });
    say(name + " seventy thousand", () => { const list = [0]; return [push(list, new Array(70_000).fill(7)), list[70_000]]; });
    say(name + " too long", () => push([], new Array(10_000_000).fill(1)));
    say(name + " frozen", () => both(Object.freeze([1]) as number[], [2]));
    say(name + " frozen, none", () => both(Object.freeze([1]) as number[], []));
    say(name + " frozen and empty, none", () => both(Object.freeze([] as number[]) as number[], []));
    say(name + " sealed", () => both(Object.seal([1]), [2]));
    say(name + " not extensible", () => both(Object.preventExtensions([1]), [2]));
    say(name + " length cannot be written", () => both(Object.defineProperty([1], "length", { writable: false }), [2]));
    say(name + " length cannot be written, none", () => both(Object.defineProperty([1], "length", { writable: false }), []));
    say(name + " a frozen source", () => both([1], Object.freeze([2, 3]) as number[]));
    say(name + " a getter in the source", () => { const target: number[] = [1]; const source = [2, 3, 4]; Object.defineProperty(source, 1, { get() { seen.push("getter sees " + show(target)); return 30; } }); return both(target, source); });
    say(name + " a setter in the target", () => { const target: number[] = [1]; Object.defineProperty(target, 3, { set(value) { seen.push("setter gets " + value); }, configurable: true }); return both(target, [2, 3]); });
    say(name + " sparse", () => { const target: number[] = []; target[100_000] = 1; return [push(target, [2, 3]), target[100_002]]; });
    say(name + " near the end", () => { const target: number[] = []; target.length = 4294967294; return [push(target, [1, 2, 3]), target.length]; });
    say(name + " a property beside the elements", () => { const target: any = [1]; target.note = "kept"; return [push(target, [2]), target, target.note]; });
  }
  say("own iterator", () => { const source = [1, 2, 3]; (source as any)[Symbol.iterator] = function* () { yield 7; yield 8; }; const a: number[] = [], b: number[] = []; return [spread(a, source), a, apply(b, source), b]; });
  say("own push", () => { const target: any = [1]; target.push = function (...values: unknown[]) { return "own " + values.join(); }; return [spread(target, [2, 3]), apply(target, [2, 3]), prototypeApply(target, [2, 3]), target]; });
  say("a class below", () => { class Below extends Array<number> { push(...values: number[]): number { return super.push(...values.map(value => value * 2)); } } const target = new Below(); return [spread(target, [1, 2]), Array.from(target), prototypeApply(target, [3]), Array.from(target)]; });
  say("a class below that adds nothing", () => { class Plain extends Array<number> {} const target = new Plain(); return [spread(target, [1, 2]), target.length, target instanceof Plain, Array.from(target)]; });
  say("a set", () => { const target: number[] = []; return [spread(target, new Set([1, 2]) as unknown as number[]), target]; });
  say("a text", () => { const target: string[] = []; return [spread(target, "ab" as unknown as string[]), target]; });
  say("an array-like", () => { const target: unknown[] = []; return [apply(target, { length: 2, 0: "a", 1: "b" } as unknown as unknown[]), target]; });
  say("no list, spread", () => spread([], null as unknown as number[]));
  say("no list, applied", () => { const target = [1]; return [apply(target, null as unknown as number[]), apply(target, undefined as unknown as number[]), target]; });
  say("no target", () => { try { return prototypeApply(null as unknown as number[], [1]); } catch (error) { return (error as Error).constructor.name; } });
  say("an object for a target", () => { const target = { length: 1, 0: "a" }; return [prototypeApply(target as unknown as string[], ["b", "c"]), JSON.stringify(target)]; });
  say("not last", () => notLast([1], [2, 3]));
  say("ignored", () => ignored([1], [2, 3]));
  say("with others", () => { const target: unknown[] = [0]; return [withOthers(target, [1, 2]), target]; });
  say("twice", () => { const target: unknown[] = [0]; return [twice(target, [1, 2]), target]; });
  say("fresh", () => [fresh(round, [4, 5, 6]), fresh(9, [1.5, 2.5])]);
  say("in try", () => [inTry([1], [2]), inTry(Object.freeze([1]) as number[], [2])]);
}
const kept: number[] = [];
for (let i = 0; i < 3000; i++) { if (kept.length > 50) kept.length = 0; spread(kept, [i, i + 1]); apply(kept, [i + 0.5]); prototypeApply(kept, holes); fresh(i, [4, 5, 6]); }
say("kept", () => kept);
console.log(seen.join("\n"));
