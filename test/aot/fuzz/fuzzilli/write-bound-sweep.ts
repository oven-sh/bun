// A counter is held against a bound that is no whole number: the head of the loop, times the bound, times the road by which the bound comes, times what a turn does. Each program holds one of each and is
// built alone.
//
//   bun write-bound-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<head>--<bound>--<road>--<turn>--<source>.ts
//   bun write-bound-sweep.ts count
//   bun write-bound-sweep.ts named <pattern> <folder> [most]
//
// A compiler that keeps a counter in a machine's whole number wants the bound as a whole number too, and rounds it once in front of the loop. Which way it has to round hangs on the relation in the head:
// `i < 15.5` holds for 15 and `i <= 15.5` does as well, `i < 15` does not hold for 15. A bound may also be no number at all, or become one only when it is asked. The function is first called with a whole
// number written in the file, then with the bound. Where the bounds stand in a list written in the file that a loop walks, a compiler sees what kinds of bound come and may build the loop a second time for
// them; where the bound comes out of data it sees nothing.
import { mkdirSync, writeFileSync } from "fs";

// N is the bound. Every head ends for every bound here: where the relation never fails the counter stops at forty.
const heads: [string, string][] = [
  ["less", "for (let i = 0; i < N; i++)"],
  ["less-or-equal", "for (let i = 0; i <= N; i++)"],
  ["the-bound-is-greater", "for (let i = 0; N > i; i++)"],
  ["the-bound-is-greater-or-equal", "for (let i = 0; N >= i; i++)"],
  ["not-greater-or-equal", "for (let i = 0; !(i >= N) && i < 40; i++)"],
  ["not-greater", "for (let i = 0; !(i > N) && i < 40; i++)"],
  ["by-twos", "for (let i = 0; i < N; i += 2)"],
  ["by-threes-or-equal", "for (let i = 0; i <= N; i += 3)"],
  ["from-one", "for (let i = 1; i < N; i++)"],
  ["from-below-zero", "for (let i = -3; i < N; i++)"],
  ["downwards", "for (let i = 20; i > N && i > -20; i--)"],
  ["downwards-or-equal", "for (let i = 20; i >= N && i > -20; i--)"],
];

// The bound as a text of JSON, or as an expression where JSON has no word for it.
const bounds: [string, string, boolean][] = [
  ["fifteen-and-a-half", "15.5", true],
  ["a-half", "0.5", true],
  ["minus-a-half", "-0.5", true],
  ["fifteen", "15", true],
  ["zero", "0", true],
  ["minus-zero", "-0", false],
  ["a-hair-over-fifteen", "15.000000000000002", true],
  ["a-hair-under-sixteen", "15.999999999999998", true],
  ["a-hair-over-zero", "5e-324", true],
  ["minus-three-and-a-half", "-3.5", true],
  ["no-number", "NaN", false],
  ["minus-infinity", "-Infinity", false],
  ["a-text-of-a-fraction", '"15.5"', true],
  ["a-text-of-a-whole-number", '"15"', true],
  ["a-text-with-spaces", '" 9.5 "', true],
  ["a-text-that-is-no-number", '"abc"', true],
  ["an-empty-text", '""', true],
  ["null", "null", true],
  ["undefined", "undefined", false],
  ["true", "true", true],
  ["a-list-of-one-fraction", "[7.5]", true],
  ["an-object-that-answers-a-fraction", "{ valueOf: () => 7.5 }", false],
  [
    "an-object-that-answers-more-each-time",
    "(asked => ({ valueOf: () => ((asked += 1) > 9 ? 0 : asked) }))(3.5)",
    false,
  ],
  ["a-number-in-an-object", "new Number(7.5)", false],
  ["a-big-integer", "7n", false],
];

// What the function takes, what it makes of that in front of the loop, and the name of the bound in the head.
const roads: [string, string, string, string][] = [
  ["a-parameter-of-any-kind", "count: any", "", "count"],
  ["made-a-number-by-plus", "given: any", "const count = +given;", "count"],
  ["made-a-number-by-a-call", "given: any", "const count = Number(given);", "count"],
  ["a-field-of-a-record", "holder: any", "", "holder.count"],
  ["a-parameter-said-to-be-a-number", "count: number", "", "count"],
  ["a-sum-with-zero", "given: any", "const count = given - 0;", "count"],
];

const turns: [string, string, string][] = [
  ["a-sum-cut-to-an-int32", "0", "total = (total + i) | 0;"],
  ["a-sum", "0", "total += i;"],
  ["a-sum-of-fractions", "0.5", "total += i;"],
  ["the-turns-are-counted", "0", "total++;"],
  ["a-text", '""', 'total += "," + i;'],
  ["a-product", "0", "total = (total + i * 3) | 0;"],
];

const sources = ["out-of-a-written-list-that-a-loop-walks", "out-of-data"] as const;

const all = heads.length * bounds.length * roads.length * turns.length * sources.length;

function write(at: number): { name: string; text: string } {
  const pick = <T>(list: readonly T[]): T => {
    const one = list[at % list.length];
    at = Math.floor(at / list.length);
    return one;
  };
  const [bound, value, inData] = pick(bounds);
  const [head, shape] = pick(heads);
  const [road, takes, inFront, named] = pick(roads);
  const [turn, starts, does] = pick(turns);
  const source = pick(sources);
  const handed = (text: string) => (road === "a-field-of-a-record" ? `{ count: ${text} }` : text);
  const text = [
    `function walk(${takes}) {`,
    `  let total = ${starts};`,
    inFront && `  ${inFront}`,
    `  ${shape.replaceAll("N", named)} ${does}`,
    "  return total;",
    "}",
    source === "out-of-data"
      ? inData
        ? `const bounds: unknown[] = [4, JSON.parse(${JSON.stringify(`[${value}]`)})[0], 7];`
        : `const bounds: unknown[] = [4, [${value}][Number(process.argv[9] ?? 0)], 7];`
      : `const bounds: unknown[] = [4, ${value}, 7, ${value}];`,
    "for (const bound of bounds) {",
    "  try {",
    `    console.log(walk(${handed("bound as any")}));`,
    "  } catch (error) {",
    "    console.log((error as Error).name);",
    "  }",
    "}",
  ]
    .filter(Boolean)
    .join("\n");
  return { name: `${head}--${bound}--${road}--${turn}--${source}.ts`, text: text + "\n" };
}

const pad = (at: number) => String(at).padStart(5, "0");
if (process.argv[2] === "count") console.log(all);
else if (process.argv[2] === "named") {
  const [pattern, folder, atMost] = [new RegExp(process.argv[3]), process.argv[4], Number(process.argv[5] ?? 500)];
  mkdirSync(folder, { recursive: true });
  let laid = 0;
  for (let at = 0; at < all && laid < atMost; at++) {
    const program = write(at);
    if (!pattern.test(program.name)) continue;
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
    laid++;
  }
  console.log(laid);
} else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? all), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, all); step++) {
    const at = (from + step * stride) % all;
    const program = write(at);
    writeFileSync(`${folder}/${pad(at)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, all));
}
