// "The callee stores parameter j into field f on every path" holds when the callee returns. Where it throws half way, the caller's handler sees an object that is half filled; where the store itself fails or is turned into something else, the field does not hold what was stored.
interface Record2 {
  a?: number;
  b?: string;
  c?: { tag: string };
}
function risky(fail: boolean): number {
  if (fail) throw new Error("failed in the middle");
  return 1;
}
function fill(r: Record2, c: { tag: string }, fail: boolean): void {
  r.a = 1;
  r.b = "b" + risky(fail);
  r.c = c;
}
function fillAndDescribe(fail: boolean): string {
  const r: Record2 = {};
  const c = { tag: "c" };
  try {
    fill(r, c, fail);
  } catch (error) {
    return "caught: " + JSON.stringify(r) + " " + (r.c === undefined) + " " + ("c" in r);
  }
  return "filled: " + JSON.stringify(r) + " " + (r.c === c);
}
let line = "";
for (let i = 0; i < 300; i++) line = fillAndDescribe(i % 100 === 99);
console.log(line, "|", fillAndDescribe(false), "|", fillAndDescribe(true));

// A constructor that throws half way, and an object that had left before.
const half: Half[] = [];
class Half {
  first: string;
  second!: string;
  constructor(fail: boolean) {
    this.first = "first";
    half.push(this);
    this.second = "second" + risky(fail);
  }
}
for (const fail of [false, true]) {
  try {
    new Half(fail);
  } catch {}
}
console.log(half.map(h => h.first + "/" + h.second + "/" + Object.keys(h).join("+")).join(" | "));

// The operand's evaluation throws between two stores of a literal, an array, a call.
function literalHalfWay(fail: boolean, seen: string[]): unknown {
  try {
    return { a: seen.push("a"), b: risky(fail), c: seen.push("c") };
  } catch {
    return seen.join();
  }
}
console.log(JSON.stringify(literalHalfWay(false, [])), literalHalfWay(true, []));

// The store does not take.
function storeAndRead<T>(o: { f: T }, v: T): T | string {
  try {
    o.f = v;
  } catch (error) {
    return (error as Error).constructor.name + ", still " + String(o.f);
  }
  return o.f;
}
let warm = 0;
for (let i = 0; i < 500; i++) warm += storeAndRead({ f: 0 }, i) as number;
console.log(warm);
const readOnly = Object.defineProperty({} as { f: number }, "f", { value: 1, writable: false });
const getterOnly = {
  get f() {
    return 2;
  },
} as { f: number };
const clamping = {
  stored: 0,
  get f() {
    return this.stored;
  },
  set f(v: number) {
    this.stored = Math.min(v, 10);
  },
};
const below = Object.create(Object.freeze({ f: 3 })) as { f: number };
const belowSetter = Object.create({
  set f(v: number) {},
  get f() {
    return 4;
  },
}) as { f: number };
const sealed = Object.preventExtensions({}) as { f: number };
console.log([storeAndRead(Object.freeze({ f: 0 }), 99), storeAndRead(readOnly, 99), storeAndRead(getterOnly, 99), storeAndRead(clamping, 99), storeAndRead(below, 99), storeAndRead(belowSetter, 99), storeAndRead(sealed, 99)].join(" | "));

// Elements: typed arrays convert, a frozen array refuses, `length` cuts.
function storeElement(list: { [i: number]: number }, i: number, v: number): number | string | undefined {
  try {
    list[i] = v;
  } catch (error) {
    return (error as Error).constructor.name;
  }
  return list[i];
}
for (let i = 0; i < 500; i++) warm += storeElement([0, 0], 1, i) as number;
console.log([storeElement(new Uint8Array(2), 0, 300), storeElement(new Uint8ClampedArray(2), 0, 300), storeElement(new Int8Array(2), 0, 200), storeElement(new Float32Array(2), 0, 0.1), storeElement(new Uint8Array(2), 5, 1), storeElement(new Int32Array(2), 0, 1.9), storeElement(new Int32Array(2), 0, NaN), storeElement(Object.freeze([1, 2]) as number[], 0, 9), storeElement([1, 2], -1, 9), storeElement([1, 2], 1.5, 9)].join(" | "));

// A primitive takes no property.
function tagIt(x: unknown, tag: string): unknown {
  try {
    (x as { tag: string }).tag = tag;
  } catch (error) {
    return (error as Error).constructor.name;
  }
  return (x as { tag: string }).tag;
}
console.log([tagIt({}, "t"), tagIt("text", "t"), tagIt(5, "t"), tagIt(true, "t"), tagIt(Symbol(), "t"), tagIt(null, "t"), tagIt(undefined, "t"), tagIt(() => 1, "t"), tagIt([], "t")].join(" | "));

// The field holds what was stored last, and "last" is decided at run time.
function storeTwice(o: { f: unknown }, first: unknown, second: unknown, both: boolean): unknown {
  o.f = first;
  if (both) o.f = second;
  return o.f;
}
function storeInLoop(o: { f: unknown }, values: unknown[]): unknown {
  for (const v of values) o.f = v;
  return o.f;
}
console.log(storeTwice({ f: 0 }, 1, "two", false), storeTwice({ f: 0 }, 1, "two", true), storeInLoop({ f: "none" }, []), storeInLoop({ f: "none" }, [1, "x", null]));

// `finally` stores after the return value was computed.
function returnsThenStores(o: { f: number }): number {
  try {
    return o.f;
  } finally {
    o.f = -1;
  }
}
const late = { f: 5 };
console.log(returnsThenStores(late), late.f);
