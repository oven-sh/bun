// Arrays, tuples, Maps, Sets and records with a declared element type hold whatever is put into them, and the loops over them do with it what plain Bun does.
function describe(value: unknown): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "symbol" || typeof value === "function") return typeof value;
  if (Array.isArray(value)) return "[" + value.map(describe).join(", ") + "]";
  if (value instanceof Map) return "Map(" + describe([...value]) + ")";
  if (value instanceof Set) return "Set(" + describe([...value]) + ")";
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return "{" + Object.keys(record).map(key => key + ": " + describe(record[key])).join(", ") + "}";
  }
  return Object.is(value, -0) ? "-0" : String(value);
}
// An error of the language (a member of null, a call of what is no function) is thrown by plain Bun too: its class is printed, not its text.
function say(label: string, run: () => unknown): void {
  let line: string;
  try {
    line = describe(run());
  } catch (error) {
    line = "THREW " + (error as Error).constructor.name;
  }
  console.log(label + ": " + line);
}
// What nobody can know at build time.
const outside: any = JSON.parse(`{"text": "t", "number": 5, "nothing": null, "list": [1, "two", null], "record": {"x": "s"}, "yes": true}`);

class Point {
  x: number = 1;
}

say("a text is pushed onto a list of numbers", () => {
  const list: number[] = [1, 2];
  (list as any).push("z");
  let total = 0;
  for (const each of list) total += each;
  return [list.map(each => typeof each), total];
});
say("a text is stored at an index of a list of numbers", () => {
  const list: number[] = [1, 2, 3];
  (list as any)[1] = "z";
  return [list[0]! + list[1]!, list[1]! * 2, list.indexOf(3), list.includes("z" as unknown as number)];
});
say("a half is stored into a list of whole numbers", () => {
  const list: number[] = [1, 2, 3];
  list[1] = 0.5;
  return [list[1], list[0]! + list[1]!, list.join()];
});
say("null and undefined are stored into a list of numbers", () => {
  const list: number[] = [1, 2, 3];
  (list as any)[0] = null;
  (list as any)[2] = undefined;
  return [list[0]! + 1, list[2]! + 1, list.join(), JSON.stringify(list)];
});
say("an object is stored into a list of numbers", () => {
  const list: number[] = [1.5, 2.5];
  (list as any)[0] = { valueOf: () => 40 };
  return [typeof list[0], list[0]! + list[1]!, Math.max(...list)];
});
say("a number is stored into a list of texts", () => {
  const list: string[] = ["a", "b"];
  (list as any)[0] = 7;
  return [typeof list[0], list[0] + list[1]!, list.join("-"), list[0]!.length];
});
say("a number in a list of texts, its method called", () => {
  const list: string[] = ["a", "b"];
  (list as any)[0] = 7;
  return list.map(each => each.toUpperCase());
});
say("a number is stored into a list of instances", () => {
  const list: Point[] = [new Point(), new Point()];
  (list as any)[1] = 7;
  return list.map(each => each.x);
});
say("null is stored into a list of instances", () => {
  const list: Point[] = [new Point(), new Point()];
  (list as any)[1] = null;
  return list.map(each => each === null);
});
say("null in a list of instances, its member read", () => {
  const list: Point[] = [new Point(), new Point()];
  (list as any)[1] = null;
  return list.map(each => each.x);
});
say("a hole in a list of numbers", () => {
  const list: number[] = [1, 2, 3];
  delete list[1];
  let total = 0;
  for (let index = 0; index < list.length; index++) total += list[index]!;
  return [1 in list, list.length, total, list.join()];
});
say("a store far beyond the end", () => {
  const list: number[] = [1];
  list[50] = 2;
  return [list.length, list[25], typeof list[25], list.filter(() => true).length];
});
say("the length is cut", () => {
  const list: number[] = [1, 2, 3];
  list.length = 1;
  return [list[2], list.length, list[2]! + 1];
});
say("a named property on a list", () => {
  const list: number[] = [1, 2];
  (list as any).extra = "e";
  return [(list as any).extra, list.length, Object.keys(list).join()];
});
say("Array.prototype.fill with another kind", () => {
  const list: number[] = [1, 2, 3];
  Array.prototype.fill.call(list, "f");
  return [list.join(), list[0]! + 1];
});
say("splice puts in other kinds", () => {
  const list: number[] = [1, 2, 3];
  (list as unknown[]).splice(1, 1, "s", null);
  return [list.length, list.map(each => typeof each)];
});
say("a list out of parsed text as a list of numbers", () => {
  const list: number[] = outside.list;
  let total = 0;
  for (const each of list) total += each;
  return total;
});
say("an array-like as a list", () => {
  const list = { length: 2, 0: "a", 1: "b" } as unknown as string[];
  return [list.length, list[0], Array.isArray(list), typeof list.map];
});
say("a typed array as a list of numbers", () => {
  const list = new Uint8Array([1, 2, 300]) as unknown as number[];
  let total = 0;
  for (let index = 0; index < list.length; index++) total += list[index]!;
  return [total, Array.isArray(list)];
});
say("a frozen list is read", () => {
  const list: readonly number[] = Object.freeze([1, 2]);
  return [list[0]! + list[1]!, list.length];
});
say("a store into a read-only list through a cast", () => {
  const list: readonly number[] = [1, 2];
  (list as number[])[0] = 5;
  (list as number[]).push(6);
  return list;
});
say("a tuple gets another kind and another length", () => {
  const pair: [number, string] = [1, "a"];
  (pair as any)[0] = "one";
  (pair as any).push(true);
  const [first, second] = pair;
  return [typeof first, first + second, pair.length];
});
say("a sort whose comparator answers other kinds", () => {
  const list: number[] = [3, 1, 2];
  return list.sort(((a: number, b: number) => (a < b ? "x" : null)) as unknown as (a: number, b: number) => number);
});

say("a Map gets a value of another kind", () => {
  const map = new Map<string, number>([["a", 1]]);
  (map as Map<string, unknown>).set("b", "two");
  let total = 0;
  for (const value of map.values()) total += value;
  return [typeof map.get("b"), map.get("b")! + 1, total];
});
say("a Map gets a key of another kind", () => {
  const map = new Map<string, number>([["1", 1]]);
  (map as Map<unknown, number>).set(1, 2);
  return [map.size, map.get("1"), map.get(1 as unknown as string), [...map.keys()].map(key => typeof key)];
});
say("a key that is not there, behind a non-null mark", () => {
  const map = new Map<string, number>();
  const value = map.get("none")!;
  return [typeof value, value + 1];
});
say("a Map of instances gets null", () => {
  const map = new Map<string, Point>([["a", new Point()]]);
  (map as Map<string, unknown>).set("b", null);
  return [...map.values()].map(each => each === null);
});
say("a Map of instances gets null, its member read", () => {
  const map = new Map<string, Point>([["a", new Point()]]);
  (map as Map<string, unknown>).set("b", null);
  return [...map.values()].map(each => each.x);
});
say("a Set gets another kind", () => {
  const set = new Set<number>([1]);
  (set as Set<unknown>).add("two").add(null);
  let total = 0;
  for (const each of set) total += each;
  return [set.size, total, set.has("two" as unknown as number)];
});
say("a record of numbers gets a text", () => {
  const record: Record<string, number> = { a: 1 };
  (record as Record<string, unknown>).b = "two";
  let total = 0;
  for (const key in record) total += record[key]!;
  return [total, typeof record.b];
});
say("a WeakMap gets a value of another kind", () => {
  const key = {};
  const map = new WeakMap<object, number>();
  (map as WeakMap<object, unknown>).set(key, "w");
  return [typeof map.get(key), map.get(key)! + 1];
});

say("in a loop: the 397th element is a text", () => {
  const list: number[] = [];
  for (let round = 0; round < 400; round++) (list as unknown[]).push(round === 396 ? "t" : 1);
  let total = 0;
  for (let index = 0; index < list.length; index++) total += list[index]!;
  return total;
});
say("in a loop: a list of numbers gets a text while it is summed", () => {
  const list: number[] = new Array(400).fill(1);
  let total = 0;
  for (let index = 0; index < list.length; index++) {
    if (index === 396) (list as unknown[])[398] = "t";
    total += list[index]!;
  }
  return total;
});
say("in a loop: a list of halves gets an object while it is summed", () => {
  const list: number[] = new Array(400).fill(0.5);
  let total = 0;
  for (let index = 0; index < list.length; index++) {
    if (index === 396) (list as unknown[])[398] = { valueOf: () => 100 };
    total += list[index]!;
  }
  return total;
});
say("in a loop: the 397th instance in a list is a record", () => {
  const list: Point[] = [];
  for (let round = 0; round < 400; round++) list.push(round === 396 ? outside.record : new Point());
  let total: unknown = 0;
  for (const each of list) total = (total as number) + each.x;
  return total;
});
say("in a loop: the 397th value of a Map is a text", () => {
  const map = new Map<number, number>();
  for (let round = 0; round < 400; round++) (map as Map<number, unknown>).set(round, round === 396 ? "t" : 1);
  let total = 0;
  for (let round = 0; round < 400; round++) total += map.get(round)!;
  return total;
});
say("in a loop: the list shrinks while it is walked", () => {
  const list: number[] = new Array(400).fill(1);
  let total = 0;
  const length = list.length;
  for (let index = 0; index < length; index++) {
    if (index === 396) list.length = 397;
    total += list[index]!;
  }
  return total;
});
