// "The result is an element of parameter 0", "the result is field f of parameter 1": the caller knows what it put there and concludes the kind of the answer. But the index is past the end, the element is a hole, the key is missing or inherited, the collection was changed on the way: the answer is undefined, or something that the caller never stored.
function first<T>(list: T[]): T {
  return list[0];
}
function last<T>(list: T[]): T {
  return list[list.length - 1];
}
function at<T>(list: T[], i: number): T {
  return list[i];
}
function atMethod<T>(list: T[], i: number): T | undefined {
  return list.at(i);
}
function popped<T>(list: T[]): T | undefined {
  return list.pop();
}
function shifted<T>(list: T[]): T | undefined {
  return list.shift();
}
function found<T>(list: T[], test: (x: T) => boolean): T | undefined {
  return list.find(test);
}
function byKey<T>(o: Record<string, T>, key: string): T {
  return o[key];
}
function fromMap<K, V>(map: Map<K, V>, key: K): V | undefined {
  return map.get(key);
}
function field(o: { f?: number }): number | undefined {
  return o.f;
}
function nested(o: { inner?: { f: number } }): number | undefined {
  return o.inner?.f;
}
function firstOfPattern<T>([head]: T[]): T {
  return head;
}
function secondOfPattern<T>([, second = "default" as T]: T[]): T {
  return second;
}
function fieldOfPattern({ f = -1 }: { f?: number }): number {
  return f;
}
function restOfPattern<T>([, ...rest]: T[]): T[] {
  return rest;
}
function plusOne(n: number): number {
  return n + 1;
}
let warm = 0;
for (let i = 0; i < 2000; i++) {
  const list = [i, i + 1, i + 2];
  warm += plusOne(first(list)) + plusOne(last(list)) + plusOne(at(list, 1)) + plusOne(atMethod(list, -1)!) + plusOne(found(list, x => x > i)!) + plusOne(byKey({ a: i }, "a")) + plusOne(fromMap(new Map([[1, i]]), 1)!) + plusOne(field({ f: i })!) + plusOne(nested({ inner: { f: i } })!);
  warm += plusOne(firstOfPattern(list)) + plusOne(secondOfPattern(list)) + plusOne(fieldOfPattern({ f: i })) + restOfPattern(list).length + plusOne(popped(list)!) + plusOne(shifted(list)!);
}
console.log(warm);
const empty: number[] = [];
console.log([first(empty), last(empty), at(empty, 0), at([1, 2], 2), at([1, 2], -1), at([1, 2], 1.5), at([1, 2], NaN), atMethod([1, 2], 2), atMethod([1, 2], -3), popped(empty), shifted(empty), found([1, 2], x => x > 5)].map(String).join());
console.log([plusOne(first(empty)), plusOne(last(empty)), plusOne(at([1, 2], 2)), plusOne(popped(empty)!), plusOne(fromMap(new Map<number, number>(), 1)!), plusOne(field({})!), plusOne(nested({})!), plusOne(byKey({}, "a"))].join());
console.log([first([, 1] as number[]), at([1, , 3] as number[], 1), firstOfPattern(empty), secondOfPattern([1]), secondOfPattern([1, undefined as unknown as number]), secondOfPattern([1, null as unknown as number]), fieldOfPattern({}), fieldOfPattern({ f: undefined }), restOfPattern(empty).length, restOfPattern([1]).length].map(String).join());

// Keys that every object answers.
const bag: Record<string, number> = { a: 1 };
console.log(["a", "b", "constructor", "toString", "__proto__", "hasOwnProperty", "valueOf", ""].map(key => typeof byKey(bag, key)).join());
const bare: Record<string, number> = Object.assign(Object.create(null), { a: 1 });
console.log(["a", "constructor", "__proto__"].map(key => typeof byKey(bare, key)).join());
console.log(["0", "length", "push", "-1", "1"].map(key => typeof byKey([7] as unknown as Record<string, number>, key)).join(), typeof byKey("text" as unknown as Record<string, number>, "0"), typeof byKey("text" as unknown as Record<string, number>, "length"));

// The collection is changed between the caller's store and the helper's read.
function readAfter<T>(list: T[], change: (list: T[]) => void): T {
  change(list);
  return list[0];
}
console.log([readAfter([1, 2], l => l.shift()), readAfter([1, 2], l => (l.length = 0)), readAfter([1, 2], l => l.reverse()), readAfter<number | string>([1, 2], l => (l[0] = "text")), readAfter([1, 2], l => delete l[0]), readAfter([1, 2], l => l.unshift(0.5)), readAfter([1, 2], l => l.fill(-0)), readAfter([1, 2], l => l.splice(0, 1, 9, 8))].map(x => (Object.is(x, -0) ? "-0" : String(x))).join());

// What comes out is the very object that went in, and taking it out of the collection does not end it.
function churn(depth: number): number {
  const pair = { left: depth, right: -depth };
  if (depth > 0) return churn(depth - 1) + pair.left;
  Bun.gc(true);
  return pair.right;
}
interface Thing {
  tag: string;
}
const keptThings: Thing[] = [];
let same = 0;
for (let i = 0; i < 300; i++) {
  const a: Thing = { tag: "a" + i };
  const b: Thing = { tag: "b" + i };
  if (first([a, b]) === a && last([a, b]) === b && at([a, b], 1) === b && popped([a, b]) === b && shifted([a, b]) === a && found([a, b], x => x === b) === b && byKey({ a, b }, "b") === b && fromMap(new Map([[a, b]]), a) === b && firstOfPattern([a]) === a && restOfPattern([a, b])[0] === b) same++;
  if (i % 100 === 99) keptThings.push(popped([{ tag: "popped " + i }])!, first([{ tag: "first " + i }]), fromMap(new Map([[1, { tag: "out of a map " + i }]]), 1)!, byKey({ k: { tag: "out of a literal " + i } }, "k"), restOfPattern([a, { tag: "rest " + i }])[0]);
}
console.log(same, churn(60), keptThings.map(t => t.tag).join(" | "));

// Lists of one kind at one site and of another kind at the next.
console.log(typeof first([1]), typeof first(["s"]), typeof first([{}]), typeof first([null]), typeof first([1.5]), typeof first([() => 1]), typeof first([1n]), typeof first([[1]]), typeof first<unknown>([undefined]), typeof first([true]), typeof first([Symbol()]));
console.log(plusOne(first([2147483647])), plusOne(first([0.5])), plusOne(first([-1])), Object.is(first([-0]), -0), first([NaN]) === first([NaN]));

// Typed arrays, strings, arguments objects, array-likes.
function firstOfAny(list: ArrayLike<unknown>): unknown {
  return list[0];
}
function argumentsOf(..._: unknown[]): IArguments {
  return (function () {
    return arguments;
  })
    // @ts-ignore: the inner function takes what it is given
    .apply(null, _);
}
console.log([firstOfAny(new Uint8Array([300])), firstOfAny(new Float32Array([0.1])), firstOfAny(new Uint8Array(0)), firstOfAny("text"), firstOfAny(""), firstOfAny(argumentsOf(5)), firstOfAny(argumentsOf()), firstOfAny({ length: 1, 0: "like" }), firstOfAny({ length: 1 }), firstOfAny(new BigInt64Array([5n]))].map(String).join());
