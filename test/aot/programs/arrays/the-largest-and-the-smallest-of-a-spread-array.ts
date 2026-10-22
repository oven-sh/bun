// Math.max(...list) and Math.min(...list) are a loop over the elements where the list is an array of int32, of doubles or of boxed elements that are numbers.
// Anything else among the elements (a hole, undefined, a text, an object with valueOf) and any other way to walk the list is the call as the language describes it.
const lines: string[] = [];
function show(v: unknown): string { return Object.is(v, -0) ? "-0" : String(v); }
function say(label: string, ...values: unknown[]): void { lines.push(label + ": " + values.map(show).join(" ")); }

function largest(list: number[]): number { return Math.max(...list); }
function smallest(list: number[]): number { return Math.min(...list); }
function largestOfAny(list: unknown[]): number { return Math.max(...(list as number[])); }
function smallestOfAny(list: unknown[]): number { return Math.min(...(list as number[])); }
function both(label: string, list: number[]): void { say(label, largest(list), smallest(list), largestOfAny(list), smallestOfAny(list)); }
function attempt(label: string, f: () => unknown): void { try { say(label, f()); } catch (error) { say(label, (error as Error).constructor.name); } }

const integers = [3, 1, 4, 1, 5, 9, 2, 6];
const doubles = [3.5, 1.25, -4.75, 9.125];
both("int32", integers);
both("doubles", doubles);
both("mapped", integers.map((x) => x));
both("mapped to doubles", integers.map((x) => x / 2));
both("filtered", integers.filter((x) => x > 2));
both("parsed", JSON.parse("[7, 2.5, -1, 1e300]") as number[]);
{
  const boxed: unknown[] = ["text", 1, 2.5, -7, 2 ** 40];
  boxed.shift();
  both("boxed, once with a text", boxed as number[]);
  const mixed: unknown[] = [{}, 1]; mixed[0] = -0; mixed[1] = 0;
  both("boxed zeros", mixed as number[]);
  mixed[0] = 0; mixed[1] = -0;
  both("boxed zeros the other way", mixed as number[]);
  mixed[1] = NaN;
  both("boxed with NaN", mixed as number[]);
  mixed[0] = Infinity; mixed[1] = -Infinity;
  both("boxed infinities", mixed as number[]);
  mixed.length = 0;
  both("boxed and empty", mixed as number[]);
}
both("empty", []);
both("one", [42]);
both("zeros", [0, -0]); both("zeros the other way", [-0, 0]); both("double zeros", [-0, 0.5, 0]);
both("NaN first", [NaN, 1, 2]); both("NaN last", [1.5, 2, NaN]);
{
  const holes: unknown[] = [{}, 1, 2, 3]; holes[0] = 5; delete holes[2];
  say("a hole among boxed elements", largestOfAny(holes), smallestOfAny(holes));
  const intHoles = [1, 2, 3]; delete intHoles[1];
  both("a hole among int32", intHoles);
  const doubleHoles = [1.5, 2.5, 3.5]; delete doubleHoles[0];
  both("a hole among doubles", doubleHoles);
  const parent = Object.create(Array.prototype) as number[];
  parent[2] = 100;
  Object.setPrototypeOf(holes, parent);
  say("the hole is filled from the prototype", largestOfAny(holes), smallestOfAny(holes));
  Object.setPrototypeOf(intHoles, parent); parent[1] = -100;
  both("and the one among int32", intHoles);
}
say("undefined", largestOfAny([1, undefined, 3]), smallestOfAny([1, undefined, 3]));
say("null", largestOfAny([1, null, 3]), smallestOfAny([1, null, 3]));
say("booleans", largestOfAny([false, true]), smallestOfAny([false, true]));
say("texts", largestOfAny(["10", "9", 3]), smallestOfAny(["10", "9", 3]), largestOfAny([1, "x"]));
{
  const order: string[] = [];
  const object = (name: string, value: number) => ({ valueOf() { order.push(name); return value; } });
  say("objects", largestOfAny([1, object("a", 5), NaN, object("b", 7), 2]), order.join());
  order.length = 0;
  const list: unknown[] = [1, 2, 3];
  list[1] = { valueOf() { order.push("changes"); list[2] = 1000; list.length = 2; return 2; } };
  say("an element changes the list", largestOfAny(list), order.join(), list.length);
}
attempt("a bigint", () => largestOfAny([1, 2n]));
attempt("a symbol", () => smallestOfAny([1, Symbol("s")]));
attempt("throws in the middle", () => largestOfAny([1, { valueOf() { throw new RangeError("no"); } }, 2n]));
{
  const long: unknown[] = [{}];
  for (let i = 0; i < 20000; i++) long[i] = (i * 7919) % 20011;
  say("long and boxed", largestOfAny(long), smallestOfAny(long));
  long[19999] = 0.5 - 1;
  say("long with a double at the end", largestOfAny(long), smallestOfAny(long));
}
{
  class List extends Array<number> {}
  const list = List.from([4, 8, 2]);
  both("a subclass", list);
  both("frozen", Object.freeze([6, 7, 5]) as number[]);
  const own = [1, 2, 3];
  (own as unknown as { [Symbol.iterator]: () => Iterator<number> })[Symbol.iterator] = function* () { yield 10; yield 20; };
  both("its own iterator", own);
}
let total = 0;
const boxedAgain = integers.map((x) => x * 1.5);
for (let round = 0; round < 3000; round++) total += largest(boxedAgain) + smallest(boxedAgain) + largest(integers) + smallest(doubles);
say("often", total);
console.log(lines.join("\n"));
