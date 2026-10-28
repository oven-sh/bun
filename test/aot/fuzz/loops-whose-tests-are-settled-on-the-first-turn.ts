// A loop whose counter starts at a number that is written out, with a test of the counter in it and, behind the test, a read that gives the same in every turn unless something in the loop stores to it.
// On the first turn the test is settled by arithmetic alone, so a compiler may work it out, take that turn out in front of the loop and read once for all the turns that follow.
//
//   starts at    0, 1, -1, 2, 7, the ends of the 32 bits and their neighbours; counts up, down, by two, by doubling, by halving, by a product, wrapped to 32 bits or not
//   the test     bits, shifts by 0, 1, 31, 32 and 33, remainders, comparisons signed and unsigned, sums and products that leave the 32 bits, bytes and half words with their signs, negation; it holds on the first turn
//                and fails later, fails on the first turn and holds later, holds always, never
//   the read     a field, a field of a field, the length of a list, its first element, a field of an element, a captured variable, a static member
//   stored to    never; in the other arm of the test; behind the read; through another name for the same object; in a function that is called; by a getter; only in the last turn
//   the turns    none at all, one, two, three, seventeen, a thousand: with no turn nothing is read, and what is handed in then has nothing to read
//   handed in    what is declared; the same names in another order; an object whose field is an accessor that counts; a frozen one; nothing at all
import type { Random } from "./random";

const prelude = `function show(value: unknown): string {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  return typeof value === "string" ? JSON.stringify(value.length > 60 ? value.slice(0, 60) + ".." + value.length : value) : String(value);
}
type Inner = { value: number };
type Holder = { a: number; inner: Inner; list: number[]; items: Inner[] };
class Shared {
  static level = 3;
}
let captured = 5;
let reads = 0;
function fresh(): Holder {
  return { a: 2, inner: { value: 4 }, list: [6, 7, 8], items: [{ value: 9 }, { value: 10 }] };
}
function otherOrder(): Holder {
  return { items: [{ value: 1 }], list: [2], inner: { value: 3 }, a: 4 };
}
function counting(): Holder {
  const o = fresh();
  Object.defineProperty(o, "a", { get: () => ++reads, set: () => void (reads += 100), configurable: true, enumerable: true });
  Object.defineProperty(o.inner, "value", { get: () => ++reads, set: () => void (reads += 100), configurable: true, enumerable: true });
  return o;
}
function frozen(): Holder {
  const o = fresh();
  Object.freeze(o);
  Object.freeze(o.inner);
  Object.freeze(o.list);
  return o;
}
function nothing(): Holder {
  return JSON.parse("null");
}
function hollow(): Holder {
  return JSON.parse("{}");
}
function touch(o: Holder, i: number): void {
  if (i === -12345) return;
  o.a += 1;
  o.inner.value += 1;
  o.list[0] += 1;
  captured += 1;
  Shared.level += 1;
}
function replace(o: Holder, i: number): void {
  o.inner = { value: i };
  o.list = [i, i];
  o.items = [{ value: i }];
}`;

const starts = ["0", "0", "0", "1", "-1", "2", "7", "2147483647", "2147483646", "-2147483648", "-2147483647", "1073741824", "65535", "255", "4294967295", "0.5"];
const steps = ["i++", "i++", "i++", "i--", "i += 2", "i = (i + 1) | 0", "i = (i - 1) | 0", "i <<= 1", "i >>= 1", "i >>>= 1", "i = (i * 3 + 1) | 0", "i = i * 2 + 1", "i += 1073741824", "i = -i", "i = ~i", "i ^= 1", "i += 0.5"];
const tests = [
  "(i & 1) === 0",
  "(i & 1) !== 0",
  "(i & 1) === 1",
  "(i & 3) === 0",
  "(i & 2) === 0",
  "!(i & 4)",
  "i % 3 === 0",
  "i % 2 === 1",
  "i % 2 === -1",
  "i < 5",
  "i <= 0",
  "i >= 0",
  "i > -1",
  "i === 0",
  "i !== 3",
  "(i >>> 31) === 0",
  "(i >>> 0) > 5",
  "(i >>> 0) < 2147483648",
  "(i >> 1) === 0",
  "(i >> 31) === 0",
  "(i >> 32) === i",
  "(i << 31) === 0",
  "(i << 32) === i",
  "(i << 33) >= 0",
  "(i >>> 33) < 4",
  "(i ^ 5) > 2",
  "(i | 0) === i",
  "i * 2 < 10",
  "i + 2147483647 > 0",
  "((i + 2147483647) | 0) > 0",
  "((i - 1) | 0) < 0",
  "((i - 1) >>> 0) > 5",
  "((i * 65537) | 0) >= 0",
  "Math.imul(i, 65537) >= 0",
  "i * 65537 * 65537 > 4294967296",
  "i / 2 === i >> 1",
  "(i & 0xff) < 128",
  "((i << 24) >> 24) >= 0",
  "((i << 16) >> 16) === i",
  "((i & 0xffff) << 16) >= 0",
  "~i < 0",
  "-i <= 0",
  "-i === 0",
  "Object.is(-i, -0)",
  "(i - 2147483648) < 0",
  "((i | 0) / 4) | 0",
  "i - i === 0",
  "(i & -i) === i",
  "Math.abs(i) === i",
  "Math.min(i, 3) === i",
  "Math.clz32(i) > 28",
];
const readings = ["o.a", "o.a", "o.inner.value", "o.inner.value", "o.list.length", "o.list[0]", "o.items[0].value", "o.items.length", "captured", "Shared.level", "o.a + o.inner.value", "o.list[o.list.length - 1]", "same.a", "o.list[i & 1]"];
const stores = [
  "",
  "",
  "o.a += 1;",
  "o.a = i;",
  "o.inner.value += 1;",
  "o.inner = { value: i };",
  "o.list.push(i);",
  "o.list = [i];",
  "o.list.length = 0;",
  "o.list[0] = i;",
  "o.list[0] = 0.5;",
  "o.items[0] = { value: i };",
  "o.items[0].value = i;",
  "o.items.pop();",
  "same.a = i;",
  "same.inner.value = i;",
  "same.inner = { value: -1 };",
  "touch(o, i);",
  "replace(o, i);",
  "captured = i;",
  "Shared.level = i;",
  "continue;",
  "break;",
  "if (turns === n - 1) o.a = 100;",
  "if (turns === n - 1) replace(o, 50);",
  `throw new RangeError("in the other arm");`,
];

function scene(random: Random, index: number): string {
  const test = random.pick(tests);
  const reading = random.sample(readings, random.between(1, 2));
  const [inTheOtherArm, behindTheRead, ahead] = [random.pick(stores), random.chance(0.3) ? random.pick(stores) : "", random.chance(0.15) ? random.pick(stores) : ""];
  const start = random.pick(starts);
  const step = random.pick(steps);
  const form = random.weighted([[5, "for"], [1, "while"], [1, "do"], [1, "nested"], [1, "bounded by the counter"]] as const); // prettier-ignore
  const inside = `${ahead ? `    ${ahead}\n` : ""}    if (${test}) {\n${reading.map(each => `      sum += ${each};`).join("\n")}\n${behindTheRead ? `      ${behindTheRead}\n` : ""}    } else {\n      sum -= 1;\n${inTheOtherArm ? `      ${inTheOtherArm}\n` : ""}    }`;
  const usesContinue = /continue;/.test(inside);
  const loop =
    form === "for" || (usesContinue && form !== "nested" && form !== "bounded by the counter")
      ? `  for (let i = ${start}, turns = 0; turns < n; turns++, ${step}) {\n${inside}\n  }`
      : form === "while"
        ? `  let i = ${start};\n  let turns = 0;\n  while (turns < n) {\n${inside}\n    turns++;\n    ${step};\n  }`
        : form === "do"
          ? `  let i = ${start};\n  let turns = 0;\n  if (n > 0)\n    do {\n${inside}\n      turns++;\n      ${step};\n    } while (turns < n);`
          : form === "nested"
            ? `  for (let outer = 0; outer < 3; outer++)\n  for (let i = ${start}, turns = 0; turns < n; turns++, ${step}) {\n${inside}\n  }`
            : `  const turns = -1;\n  for (let i = 0; i < n; i++) {\n${inside}\n  }`;
  const callers = random.sample(["fresh()", "fresh()", "otherOrder()", "counting()", "frozen()", "hollow()"], random.between(2, 4));
  const counts = random.sample([0, 1, 2, 3, 17, 1000], random.between(3, 5)).sort((a, b) => a - b);
  return `function loop${index}(o: Holder, n: number): string {
  const same = o;
  let sum = 0;
${loop}
  return show(sum);
}
for (const n of [${counts.join(", ")}]) {
  for (const make of [${callers.map(each => each.replace("()", "")).join(", ")}]) {
    const o = make();
    let said: string;
    try {
      said = loop${index}(o, n);
    } catch (error) {
      said = "throws " + (error instanceof Error ? error.constructor.name : typeof error);
    }
    console.log(${index}, n, make.name, said, JSON.stringify(o), captured, Shared.level, reads);
  }
}
try {
  for (let again = 0; again < 200; again++) loop${index}(fresh(), 5);
} catch {}
try {
  console.log(${index}, "nothing, no turn", loop${index}(nothing(), 0));
  console.log(${index}, "nothing, one turn", loop${index}(nothing(), 1));
} catch (error) {
  console.log(${index}, "throws", error instanceof Error ? error.constructor.name : typeof error);
}`;
}

export function generate(random: Random): string {
  return [prelude, ...Array.from({ length: random.between(2, 5) }, (_, index) => scene(random, index))].join("\n") + "\n";
}
