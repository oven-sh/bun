// The elements of one array go behind those of another: every pairing of what the two hold, holes, no room, long sources, literals that are shared until written to.
function given<T>(text: string): T { return JSON.parse(text) as T; }
function show(label: string, list: unknown[]): void {
  const parts: string[] = [];
  for (let i = 0; i < list.length; i++) parts.push(i in list ? typeof list[i] + ":" + String(list[i]) : "hole");
  console.log(label, list.length, parts.join(","));
}
function joinValues(a: unknown[], b: unknown[]): unknown[] { return [...a, ...b]; }
function joinStrings(a: string[], b: string[]): string[] { return [...a, ...b]; }
function joinNumbers(a: number[], b: number[]): number[] { return [...a, ...b]; }
function around(a: unknown[], first: unknown, last: unknown): unknown[] { return [first, ...a, last]; }
function pushAll(target: unknown[], a: unknown[]): number { return target.push(...a); }
function pushNumbers(target: number[], a: number[]): number { return target.push(...a); }
function thrice(a: number[]): number[] { return [...a, ...a, ...a]; }

const strings = given<string[]>('["a","b","c"]');
const integers = given<number[]>("[1,2,3]");
const doubles = given<number[]>("[1.5,2.5,-0.25]");
const wholeDoubles = given<number[]>("[1.5,2,3]");
const mixed = given<unknown[]>('[1,"x",null,true,{"k":1},[2]]');
const none = given<string[]>("[]");
const objects = given<{ n: number }[]>('[{"n":1},{"n":2}]');

show("strings+strings", joinStrings(strings, strings));
show("strings+none", joinStrings(strings, none));
show("none+strings", joinStrings(none, strings));
show("none+none", joinStrings(none, none));
show("integers+integers", joinNumbers(integers, integers));
show("integers+doubles", joinNumbers(integers, doubles));
show("doubles+integers", joinNumbers(doubles, integers));
show("doubles+doubles", joinNumbers(doubles, doubles));
show("whole doubles", joinNumbers(wholeDoubles, wholeDoubles));
show("values: strings+integers", joinValues(strings, integers));
show("values: integers+strings", joinValues(integers, strings));
show("values: doubles+strings", joinValues(doubles, strings));
show("values: whole doubles+mixed", joinValues(wholeDoubles, mixed));
show("values: mixed+doubles", joinValues(mixed, doubles));
show("around strings", around(strings, 0, "z"));
show("around doubles", around(doubles, "first", 9.5));
show("around integers", around(integers, 0.5, 7));
show("thrice integers", thrice(integers));
show("thrice doubles", thrice(doubles));

// A whole number that came out of an array of doubles is the same number everywhere.
const fromDoubles = joinValues(wholeDoubles, none);
console.log(fromDoubles[1] === 2, Object.is(fromDoubles[1], 2), fromDoubles.indexOf(3), fromDoubles.includes(2), new Set(fromDoubles).has(3), JSON.stringify(fromDoubles));
const negativeZero = joinValues([1.5, -0], none);
console.log(Object.is(negativeZero[1], -0), 1 / (negativeZero[1] as number));

// Holes read as undefined.
const holeyStrings: string[] = ["a", , "c"] as string[];
const holeyIntegers: number[] = [1, , 3] as number[];
const holeyDoubles: number[] = [1.5, , 3.5] as number[];
const lastIsHole: number[] = [1, 2, ,] as number[];
const firstIsHole: number[] = [, 2, 3] as number[];
show("holey strings", joinStrings(holeyStrings, holeyStrings));
show("holey integers", joinNumbers(holeyIntegers, integers));
show("integers+holey integers", joinNumbers(integers, holeyIntegers));
show("holey doubles", joinNumbers(holeyDoubles, doubles));
show("doubles+holey doubles", joinNumbers(doubles, holeyDoubles));
show("doubles+holey integers", joinNumbers(doubles, holeyIntegers));
show("last is a hole", joinNumbers(integers, lastIsHole));
show("first is a hole", joinNumbers(integers, firstIsHole));
show("values: holey doubles", joinValues(holeyDoubles, holeyIntegers));
show("only holes", joinValues(new Array(3), new Array(2)));
const numbersThenHole: number[] = [1, 2];
console.log(pushNumbers(numbersThenHole, holeyIntegers), pushNumbers(numbersThenHole, integers));
show("pushed holes", numbersThenHole);
const doublesThenHole: number[] = [0.5];
console.log(pushNumbers(doublesThenHole, holeyDoubles), pushNumbers(doublesThenHole, holeyIntegers), pushNumbers(doublesThenHole, doubles));
show("pushed holes into doubles", doublesThenHole);

// NaN is an element, not a hole.
const withNaN = given<number[]>("[1.5,2.5]"); withNaN[1] = NaN;
show("NaN", joinNumbers(withNaN, withNaN));
show("values: NaN", joinValues(withNaN, strings));

// No room, and sources of every length round the longest that is copied element by element.
for (const length of [1, 2, 7, 8, 63, 64, 65, 66, 200]) {
  const longStrings: string[] = [], longIntegers: number[] = [], longDoubles: number[] = [];
  for (let i = 0; i < length; i++) { longStrings.push("s" + i); longIntegers.push(i); longDoubles.push(i + 0.5); }
  const s = joinStrings(longStrings, longStrings), n = joinNumbers(longIntegers, longDoubles), v = joinValues(longDoubles, longStrings);
  console.log(length, s.length, s[0], s[length - 1], s[length], s[2 * length - 1], n.length, n[length - 1], n[length], n[2 * length - 1], v.length, v[length - 1], v[length]);
  const grown: unknown[] = [];
  let pushed = 0;
  for (let round = 0; round < 5; round++) pushed = pushAll(grown, round & 1 ? longStrings : longIntegers);
  console.log(pushed, grown.length, grown[length - 1], grown[length], grown[grown.length - 1]);
}

// A literal is shared until somebody writes to it.
function literalStrings(): string[] { return ["x", "y"]; }
function literalIntegers(): number[] { return [7, 8]; }
function literalDoubles(): number[] { return [7.5, 8.5]; }
for (let round = 0; round < 3; round++) {
  const s = literalStrings(), i = literalIntegers(), d = literalDoubles();
  console.log(pushAll(s, strings), pushNumbers(i, integers), pushNumbers(d, doubles), pushNumbers(i, doubles), pushAll(s, literalIntegers()));
  show("written literal of strings", s); show("written literal of integers", i); show("written literal of doubles", d);
  show("literals joined", joinValues(literalStrings(), literalDoubles()));
}

// The source is the target.
const self: unknown[] = [1, "two", 3.5];
console.log(pushAll(self, self), pushAll(self, self));
show("self", self);
const selfNumbers: number[] = [1, 2];
console.log(pushNumbers(selfNumbers, selfNumbers));
show("self numbers", selfNumbers);

// What is appended is kept alive and is the same object.
const kept: unknown[][] = [];
for (let round = 0; round < 2000; round++) kept.push(joinValues(objects, [{ n: round }, "text" + round, round + 0.5]));
Bun.gc(true);
let sum = 0;
for (const list of kept) sum += (list[0] as { n: number }).n + (list[2] as { n: number }).n + (list[3] as string).length + (list[4] as number);
console.log(sum, kept[5][0] === objects[0], kept[1999][1] === objects[1]);

// An old array takes young objects.
const old: unknown[] = []; for (let i = 0; i < 40; i++) old.push(null);
old.length = 0; Bun.gc(true); Bun.gc(true);
for (let round = 0; round < 10; round++) { old.length = 0; pushAll(old, [{ n: round }, { n: round + 1 }, ["in", round]]); Bun.gc(false); }
console.log(JSON.stringify(old));

// Frozen and sealed sources, and a target that takes nothing more.
show("frozen source", joinValues(Object.freeze(["f", 1]) as unknown[], Object.seal([2.5]) as unknown[]));
try { pushAll(Object.freeze(["f"]) as unknown[], strings); } catch (error) { console.log((error as Error).constructor.name); }
try { pushAll(Object.preventExtensions(["f"]) as unknown[], strings); } catch (error) { console.log((error as Error).constructor.name); }
