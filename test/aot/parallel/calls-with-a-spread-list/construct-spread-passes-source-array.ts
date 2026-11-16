// `new F(...array)` with an unknown F used to copy the array and pass the copy. It passes the array itself. Nothing the constructor does to its arguments shows in the array.
// STATISTIC: SpreadCallArrayCopiesElided >= 2
type Constructor = new (...args: any[]) => any;
const seen: string[] = [];
let shared: any[] = [];
const constructors: Constructor[] = [
  class { text: string; constructor(a: any, b: any) { this.text = a + "|" + b; } },
  class { text: string; constructor(...rest: any[]) { rest.push("more"); rest[0] = "changed"; this.text = rest.join(); } },
  function (this: any) { arguments[0] = "written"; arguments.length = 1; this.text = Array.prototype.join.call(arguments); } as any,
  class { text: string; constructor(a: any, b: any, c: any) { shared.length = 0; shared.push("emptied"); this.text = [a, b, c].join(); } },
  class { text: string; constructor(a: any, b: any, c: any, d: any, e: any, f: any, g: any, h: any) { this.text = [h, g, f, e, d, c, b, a].join(); } },
  class { text: string; constructor() { this.text = new.target === undefined ? "no target" : typeof new.target + " " + arguments.length; } },
  function () { return { text: "another object " + arguments.length }; } as any,
];
function constructEach(array: any[]) {
  for (let i = 0; i < constructors.length; i++) seen.push(new constructors[i](...array).text + " < " + array.join() + " " + array.length);
}
function constructOne(F: Constructor, array: any[]) { return new F(...array); }
function afterOthers(F: Constructor, array: any[]) { return new F("first", ...array); }
function beforeOthers(F: Constructor, array: any[]) { return new F(...array, "last"); }
function twice(F: Constructor, array: any[]) { return new F(...array, ...array); }
function message(run: () => unknown) { try { return String(run()); } catch (error: any) { return error.constructor.name + ": " + error.message; } }
const holes = [1, , 3]; const doubles = [0.5, 1.5, , 2.5]; const nan = [NaN, 0.25]; const strings = ["a", "b"]; const none: any[] = []; const nine = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const mixed: any[] = [1, "two", 3.5, null, undefined, { toString() { return "object"; } }];
for (const array of [holes, doubles, nan, strings, none, nine, mixed]) constructEach(array);
shared = ["x", "y", "z"]; constructEach(shared); seen.push(shared.join());
const long: number[] = []; for (let i = 0; i < 5000; i++) long.push(i);
seen.push(constructOne(class { text: string; constructor(...rest: any[]) { this.text = rest.length + " " + rest[4999]; } }, long).text);
for (const F of constructors) seen.push(constructOne(F, strings).text, afterOthers(F, strings).text, beforeOthers(F, strings).text, twice(F, strings).text);
seen.push(message(() => constructOne((() => 1) as any, strings)), message(() => constructOne(undefined as any, strings)), message(() => constructOne(Math.max as any, strings)));
seen.push(String(constructOne(Array as any, [3]).length), String(constructOne(Array as any, [3, 4]).length), constructOne(Date as any, [2020, 0, 2]).toISOString().slice(0, 4));
const said: string[] = [];
const overGetter: any[] = Object.setPrototypeOf([1, , 3], Object.create(Array.prototype, { 1: { configurable: true, get() { said.push("getter ran"); return "from the prototype"; } } }));
seen.push(constructOne(constructors[0], overGetter).text, constructOne(constructors[1], overGetter).text, said.join(), overGetter.join());
const ownIterator: any[] = [1, 2, 3]; ownIterator[Symbol.iterator] = function* () { said.push("iterator ran"); yield "from"; yield "another iterator"; } as any;
seen.push(constructOne(constructors[0], ownIterator).text, constructOne(constructors[1], ownIterator).text, said.join(), ownIterator.length + "");
class Reversed extends Array { *[Symbol.iterator](): any { for (let i = this.length; i--; ) yield this[i]; } }
seen.push(constructOne(constructors[1], Reversed.from(["x", "y", "z"])).text);
seen.push(constructOne(constructors[1], new Set(["in", "a", "set"]) as any).text, constructOne(constructors[1], "text" as any).text, message(() => constructOne(constructors[1], 5 as any)));
console.log(seen.join("\n"));
