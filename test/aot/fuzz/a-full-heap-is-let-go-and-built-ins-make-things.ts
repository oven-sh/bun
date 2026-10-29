// A program keeps objects alive until no more fit, lets all of them or the older half go (every other one would leave no room for objects of another size), and at once calls one built-in that makes things, thousands of times, with nothing else between. There is room again: no call may fail.
//
//   kept       records, lists, closures, texts, numbers with a fraction, instances, maps
//   let go     everything, by a new list, by a length of zero, by leaving the function that held it; or every second one
//   the work   exec, match, matchAll, split, replace; JSON.parse, structuredClone; entries, keys, assign, a spread, fromEntries, groupBy, descriptors; map, slice, flat, from, sort, fill; a Map, a Set, a Date, an Error,
//              a pattern, bytes, a bound function, arguments, a promise, a generator, a big integer, an instance with private names
//   again      two to four times in one process
//
// The objects of a compiled program live in one range of address space: BUN_JSC_markedBlockCageSizeInMB=64 makes it small. Plain Bun has no such end: there, and wherever the range is large, a fill ends with a RangeError of the
// program's own after more objects than fit into 64 MB. Nothing that is printed depends on where the end is.
import type { Random } from "./random";

const kept = [
  `{ a: n, b: n, c: n, d: n }`,
  `[n, n, n, n, n, n]`,
  `() => n`,
  `{ a: { b: n }, c: [n] }`,
  `"t" + n + "-" + n`,
  `[n + 0.5, n + 1.5, n + 2.5, n + 3.5]`,
  `new Point(n, n)`,
  `new Map([[n, n]])`,
];

const work = [
  `/a(b)c/.exec("abc")![1]`,
  `"abcabc".match(/b/g)!.length`,
  `[..."abc".matchAll(/./g)].length`,
  `"a,b,c,d".split(",").length`,
  `"abc".replace(/b/, "$&$&")`,
  `"a-b-c".replaceAll("-", "+" + (turn % 3))`,
  `JSON.parse('{"a":[1,2,{"b":3}]}').a.length`,
  `JSON.stringify({ a: [turn, { b: "x" }] })`,
  `structuredClone({ a: [1, turn] }).a[1]`,
  `Object.entries(record).length`,
  `Object.keys(record).length`,
  `Object.assign({}, record).b`,
  `({ ...record, turn }).turn`,
  `Object.fromEntries([["a", turn]]).a`,
  `Object.groupBy([1, 2, 3], one => (one % 2 ? "odd" : "even")).odd!.length`,
  `Object.getOwnPropertyDescriptors(record).a.value`,
  `Reflect.ownKeys(record).length`,
  `[1, 2, 3].map(one => one + turn)[2]`,
  `[1, 2, 3, 4].slice(1).length`,
  `[1, [2, [3, [turn]]]].flat(3).length`,
  `Array.from({ length: 5 }, (_, at) => at).length`,
  `[3, 1, 2].sort()[0]`,
  `[3, 1, 2].toSorted()[0]`,
  `new Array(8).fill(turn)[7]`,
  `[...[1, 2, 3], turn].length`,
  `new Map([[1, turn]]).get(1)`,
  `new Set([1, 2, turn]).size`,
  `new Date(turn).getUTCFullYear()`,
  `new Error("e" + turn).message.length`,
  `new RegExp("a" + (turn % 3)).source`,
  `new Uint8Array(16).length`,
  `add.bind(null, turn)(1)`,
  `(function (..._: number[]) {\n        return arguments.length;\n      })(1, 2, turn)`,
  `typeof Promise.resolve(turn)`,
  `steps(turn).next().value`,
  `String(BigInt(turn) * 3n).length`,
  `new Hidden(turn).read()`,
  `String(turn).padStart(12, "0")`,
  `\`\${turn}:\${turn + 0.5}\``,
  `Symbol("s" + turn).description`,
];

const prelude = `class Point {
  constructor(
    public x: number,
    public y: number,
  ) {}
}
class Hidden {
  #value: number;
  constructor(value: number) {
    this.#value = value;
  }
  read(): number {
    return this.#value;
  }
}
function add(a: number, b: number): number {
  return a + b;
}
function* steps(from: number): Generator<number> {
  yield from;
}
const record = { a: 1, b: "two", c: [3] };
function fold(sum: number, value: unknown): number {
  return (sum * 31 + String(value).length) % 1000003;
}`;

function round(random: Random, index: number): string {
  const n = String(index);
  const thing = random.pick(kept);
  const letGo = random.weighted([[3, "new list"], [2, "length"], [2, "left"], [2, "half"]] as const); // prettier-ignore
  const isLocal = letGo === "left";
  const fill = `function fill${n}(${isLocal ? "" : "held: unknown[]"}): boolean {
${isLocal ? "  const held: unknown[] = [];\n" : ""}  try {
    for (let n = 0; ; n++) {
      held.push(${thing});
      if (n >= 3000000) throw new RangeError("enough");
    }
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  return held.length > 1000;
}`;
  const acts = random.shuffled(work).slice(0, random.weighted([[4, 1], [1, 2], [1, 3]])); // prettier-ignore
  const works = `function work${n}(): string {
  let sum = 0;
  let failed = 0;
  for (let turn = 0; turn < ${random.pick([2000, 20000, 60000])}; turn++) {
    try {
${acts.map(act => `      sum = fold(sum, ${act});`).join("\n")}
    } catch (error) {
      failed++;
    }
  }
  return sum + " failed " + failed;
}`;
  // Nothing is printed while the heap is full.
  const go =
    letGo === "left" ? `const filled${n} = fill${n}();`
    : letGo === "new list" ? `const filled${n} = fill${n}(held);\nheld = [];`
    : letGo === "length" ? `const filled${n} = fill${n}(held);\nheld.length = 0;`
    : `const filled${n} = fill${n}(held);\nfor (let at = 0; at < held.length / 2; at++) held[at] = null;`; // prettier-ignore
  return `${fill}\n${works}\n${go}\nconst worked${n} = work${n}();\nconsole.log("${n} filled", filled${n}, "work", worked${n});${letGo === "half" ? "\nheld = [];" : ""}`;
}

export function generate(random: Random): string {
  return (
    [
      prelude,
      "let held: unknown[] = [];",
      ...Array.from({ length: random.between(2, 4) }, (_, index) => round(random, index)),
      "export {};",
    ].join("\n") + "\n"
  );
}
