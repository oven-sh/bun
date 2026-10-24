// `function at<T>(a: T[], i: number): T { return a[i]; }`: "the result is an element of parameter 0" holds while i is an index. The declared type of i proves nothing: after thousands of honest calls on arrays of small integers come "length", "constructor", -1, 1.5, "0", a Symbol, an object with toString.
function at<T>(a: T[], i: number): T {
  return a[i];
}
function put<T>(a: T[], i: number, v: T): T {
  a[i] = v;
  return a[i];
}
function has<T>(a: T[], i: number): boolean {
  return i in a;
}
function drop<T>(a: T[], i: number): boolean {
  return delete a[i];
}
function plusOne(n: number): number {
  return n + 1;
}
function atPlusOne(a: number[], i: number): number {
  return plusOne(at(a, i));
}
function field(o: Record<string, number>, key: string): number {
  return o[key];
}
const lie = <T,>(x: unknown): T => x as T;
const attempt = (f: () => unknown): unknown => {
  try {
    return f();
  } catch (error) {
    return (error as Error).constructor.name;
  }
};
let warm = 0;
for (let i = 0; i < 4000; i++) {
  const list = [i, i + 1, i + 2];
  warm += at(list, i % 3) + atPlusOne(list, 1) + put(list, 2, i) + (has(list, 1) ? 1 : 0) + field({ a: i }, "a");
}
console.log(warm);
const show = (x: unknown): string => (typeof x === "function" ? "function " + x.name : typeof x === "symbol" ? "symbol" : typeof x + ":" + String(x));
const order: string[] = [];
const keys: unknown[] = [
  "length",
  "constructor",
  -1,
  1.5,
  "0",
  "1",
  "01",
  "-0",
  -0,
  NaN,
  Infinity,
  4294967295,
  4294967294,
  2147483648,
  "push",
  "__proto__",
  Symbol.iterator,
  null,
  undefined,
  true,
  [1],
  {
    toString() {
      order.push("toString");
      return "2";
    },
  },
  {
    [Symbol.toPrimitive](hint: string) {
      order.push(hint);
      return 0;
    },
  },
  1n,
];
for (const key of keys) {
  const list = [10, 20, 30];
  console.log(show(key).slice(0, 24).padEnd(24), show(at(list, lie(key))), "|", show(atPlusOne(list, lie(key))), "|", has(list, lie(key)), "|", order.splice(0).join());
}

// What was stored under such a key is found under it again, and is no element.
const odd = [1, 2, 3];
console.log(put(odd, lie(-1), lie("minus one")), put(odd, lie(1.5), lie("one and a half")), put(odd, lie("x"), lie("under x")), put(odd, lie("01"), lie("under 01")), odd.length, odd.join(), Object.keys(odd).join());
console.log(show(at(odd, lie(-1))), show(at(odd, lie(1.5))), show(at(odd, lie("x"))), show(at(odd, lie("01"))), show(at(odd, 1)), show(atPlusOne(odd, lie(-1))));
console.log(put(odd, lie("length"), 1), odd.join(), put(odd, 5, 6), odd.length, odd.join(), drop(odd, lie("x")), drop(odd, 0), attempt(() => drop(odd, lie("length"))), Object.keys(odd).join());

// The receiver is not what its type says either.
const receivers: unknown[] = ["text", new String("boxed"), new Uint8Array([7, 8]), { 0: "object", length: 1 }, new Map([[0, "map"]]), function named(a: unknown, b: unknown) {}, 5, true, Object.create([9, 8])];
for (const r of receivers) console.log(show(at(lie<unknown[]>(r), 0)), show(at(lie<unknown[]>(r), lie("length"))), show(at(lie<unknown[]>(r), 5)), show(at(lie<unknown[]>(r), lie("name"))));
for (const r of [null, undefined]) {
  try {
    at(lie<unknown[]>(r), 0);
  } catch (error) {
    console.log((error as Error).constructor.name);
  }
}

// The key is evaluated once, before the value, and after the receiver.
function ordered(log: string[]): number {
  const a = [0, 0];
  const receiver = () => (log.push("receiver"), a);
  const key = () => (log.push("key"), { toString: () => (log.push("toString"), "1") });
  const value = () => (log.push("value"), 5);
  receiver()[lie<number>(key())] = value();
  return a[1];
}
const log: string[] = [];
console.log(ordered(log), log.join());
function compound(log: string[]): number {
  const a = [1, 2];
  a[lie<number>({ toString: () => (log.push("toString"), "1") })] += 10;
  return a[1];
}
log.length = 0;
console.log(compound(log), log.join());

// Names as numbers and numbers as names on plain objects.
const bag: Record<string, number> = { 1: 10, "2": 20, "03": 30, "-1": 40, "1.5": 50 };
console.log([field(bag, lie(1)), field(bag, "1"), field(bag, lie(2)), field(bag, lie(3)), field(bag, "03"), field(bag, lie(-1)), field(bag, lie(1.5)), field(bag, lie(1.0)), field(bag, "1.0")].map(String).join());
