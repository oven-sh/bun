// `super(...array)` used to copy the array and pass the copy. It passes the array itself. Nothing the parent does to its arguments shows in the array.
// STATISTIC: SpreadCallArrayCopiesElided >= 2
const seen: string[] = [];
let shared: any[] = [];
class TakesTwo { text: string; constructor(a?: any, b?: any) { this.text = a + "|" + b; } }
class TakesRest { text: string; constructor(...rest: any[]) { rest.push("more"); rest[0] = "changed"; this.text = rest.join(); } }
class WritesArguments { text: string; constructor() { arguments[0] = "written"; arguments.length = 1; this.text = Array.prototype.join.call(arguments); } }
class EmptiesShared { text: string; constructor(a?: any, b?: any, c?: any) { shared.length = 0; shared.push("emptied"); this.text = [a, b, c].join(); } }
class TakesNine { text: string; constructor(a?: any, b?: any, c?: any, d?: any, e?: any, f?: any, g?: any, h?: any, i?: any) { this.text = [i, h, g, f, e, d, c, b, a].join(); } }
class NamesTarget { text: string; constructor() { this.text = new.target.name + " " + arguments.length; } }
function OldStyle(this: any) { this.text = "old style " + arguments.length + " " + arguments[0]; }
const parents: any[] = [TakesTwo, TakesRest, WritesArguments, EmptiesShared, TakesNine, NamesTarget, OldStyle];
class Child extends TakesTwo {
  after: string;
  constructor(array: any[]) { super(...array); this.after = Array.isArray(array) ? array.join() + " " + array.length : typeof array; }
}
class ChildOfRest extends TakesTwo {
  after: string;
  constructor(...rest: any[]) { super(...rest); this.after = rest.join() + " " + rest.length; }
}
class ChildWithFirst extends TakesTwo { constructor(array: any[]) { super("first", ...array); } }
class ChildWithLast extends TakesTwo { constructor(array: any[]) { super(...array, "last"); } }
class ChildTwice extends TakesTwo { constructor(array: any[]) { super(...array, ...array); } }
function message(run: () => unknown) { try { return String(run()); } catch (error: any) { return error.constructor.name + ": " + error.message; } }
const holes = [1, , 3]; const doubles = [0.5, 1.5, , 2.5]; const nan = [NaN, 0.25]; const strings = ["a", "b"]; const none: any[] = []; const ten = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const mixed: any[] = [1, "two", 3.5, null, undefined, { toString() { return "object"; } }];
for (const parent of parents) {
  for (const child of [Child, ChildOfRest, ChildWithFirst, ChildWithLast, ChildTwice]) Object.setPrototypeOf(child, parent);
  for (const array of [holes, doubles, nan, strings, none, ten, mixed]) {
    const one = new Child(array); seen.push(parent.name + ": " + one.text + " < " + one.after);
    const two = new ChildOfRest(...array); seen.push(parent.name + ": " + two.text + " < " + two.after);
    seen.push(new ChildWithFirst(array).text, new ChildWithLast(array).text, new ChildTwice(array).text);
  }
  shared = ["x", "y", "z"]; const three = new Child(shared); seen.push(three.text + " < " + three.after + " < " + shared.join());
}
const long: number[] = []; for (let i = 0; i < 5000; i++) long.push(i);
Object.setPrototypeOf(Child, class { text: string; constructor(...rest: any[]) { this.text = rest.length + " " + rest[4999]; } });
seen.push(new Child(long).text);
Object.setPrototypeOf(Child, null); seen.push(message(() => new Child(strings)));
Object.setPrototypeOf(Child, () => 1); seen.push(message(() => new Child(strings)));
Object.setPrototypeOf(Child, Array); seen.push(String((new Child([3]) as any).length), String((new Child([3, 4]) as any).length));
Object.setPrototypeOf(Child, TakesTwo);
const said: string[] = [];
const overGetter: any[] = Object.setPrototypeOf([1, , 3], Object.create(Array.prototype, { 1: { configurable: true, get() { said.push("getter ran"); return "from the prototype"; } } }));
seen.push(new Child(overGetter).text, said.join(), overGetter.join());
const ownIterator: any[] = [1, 2, 3]; ownIterator[Symbol.iterator] = function* () { said.push("iterator ran"); yield "from"; yield "another iterator"; } as any;
seen.push(new Child(ownIterator).text, said.join());
seen.push(new Child(new Set(["in", "a set"]) as any).text, new Child("text" as any).text, message(() => new Child(5 as any)));
seen.push(Reflect.construct(Child, [strings], NamesTarget).text);
console.log(seen.join("\n"));
