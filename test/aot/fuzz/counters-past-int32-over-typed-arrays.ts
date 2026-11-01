// `for (let i = o.n; i > 2147483649; i--) L[i & 3] = ...`: a loop whose counter starts at a number that no int32 holds.
// A compiler that makes a copy of a loop for small integers has a copy here that never runs, or runs for some calls alone, and what it
// concluded for that copy must not reach the other. Each function is small: one counted loop over a typed array and an object, a guard
// that ends it after a few turns, and in each turn two to four statements: a short inner loop whose counter starts from the outer one,
// a store or a load at a masked index, which may lie outside the array, or a sum. The counters are counters and nothing else: one start,
// one step, no other store. What varies: where the start and the bound come from (a property, a parameter, a written number), which edge
// they lie at (2 ** 31, 2 ** 32, -(2 ** 31), 2 ** 53, or none), the direction, where the step stands, the kind and length of the array,
// and how the numbers are handed back. Every argument is written at the call. Another object with the same keys holds small numbers.
import type { Random } from "./random";

export interface Shape {
  name: string;
  text: string;
  calls: string[];
}

const edges = [
  2147483647, 2147483648, 4294967295, 4294967296, -2147483648, -2147483649, 9007199254740980, 1073741824, 65536,
];
const kinds = [
  "Float64Array",
  "Float64Array",
  "Int32Array",
  "Int32Array",
  "Uint8Array",
  "Uint32Array",
  "Float32Array",
  "Int16Array",
  "Uint8ClampedArray",
];

export function helpers(typed: boolean): string {
  return `function show(v${typed ? ": unknown" : ""})${typed ? ": string" : ""} {
  return typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : String(v);
}
`;
}

export function shapeOf(random: Random, name: string, typed: boolean): Shape {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const kind = random.chance(0.12) ? "number[]" : random.pick(kinds);
  const mask = random.pick([1, 3, 3, 7, 15]);
  const goesDown = random.chance(0.6);
  const turns = random.between(1, 3);
  const step = random.chance(0.8) ? 1 : 2;
  const start = random.pick(edges) + random.between(-2, 3);
  const bound = goesDown ? start - turns * step : start + turns * step;

  const startFrom = random.weighted([
    [5, "o.n"],
    [2, "a"],
    [1, String(start)],
  ] as const);
  const boundFrom = random.weighted([
    [5, String(bound)],
    [2, "o.b"],
    [2, "b"],
  ] as const);
  const test = goesDown
    ? `i ${random.pick([">", ">", ">="])} ${boundFrom}`
    : `i ${random.pick(["<", "<", "<="])} ${boundFrom}`;
  const stepped = goesDown
    ? step === 1
      ? random.pick(["i--", "--i", "i -= 1"])
      : "i -= 2"
    : step === 1
      ? random.pick(["i++", "++i", "i += 1"])
      : "i += 2";
  const stepsInTheHead = random.chance(0.35);
  const keepsTheOldValue = !stepsInTheHead && step === 1 && random.chance(0.6);
  const counter = () => (keepsTheOldValue && random.chance(0.6) ? "p" : "i");

  let inners = 0;
  // A store far outside a typed array does nothing; in a list it would set a length of billions.
  const far = kind === "number[]" ? 0 : 1;
  const index = (from: string) =>
    random.weighted([
      [6, `${from} & ${mask}`],
      [2 * far, `${from} - ${Math.min(start, bound)}`],
      [1, `${from} % ${mask + 1}`],
      [far, from],
    ] as const);
  const inner = (from: string) => {
    const j = `j${inners++}`;
    const [low, high] = random.pick([
      [`${from} - 1`, from],
      [from, `${from} + 2`],
      [from, from],
      [`${from} - 2`, `${from} + 1`],
    ]);
    const body = random.pick([
      `z += ${j};`,
      `y += ${j} * 0.25;`,
      `v = L[${index(j)}]; z += v;`,
      `v = L[${index(j)}]; z = (z + (v | 0)) | 0;`,
      `L[${index(j)}] = ${j};`,
      `z ^= ${j};`,
    ]);
    return `for (let ${j} = ${low}; ${j} < ${high}; ${random.pick([`${j}++`, `++${j}`, `${j} += 1`])}) { ${body} }`;
  };
  const statement = (from: string) =>
    random.weighted([
      [7, () => inner(from)],
      [2, () => `L[${index(from)}] = ${random.pick(["o.m[t & 1]", "t", from, `${from} + 0.5`])};`],
      [2, () => `v = L[${index(from)}]; ${random.pick(["z += v;", "y += v;", "z = (z + (v | 0)) | 0;"])}`],
      [
        2,
        () =>
          random.pick([
            `z += ${from} & 255;`,
            `z += ${from} | 0;`,
            `y += ${from} >>> 0;`,
            `y = ${from} % 7;`,
            `z ^= ${from};`,
            `y += ${from};`,
            `z += ${from} > 2147483647 ? 1 : 2;`,
          ]),
      ],
    ] as const)();

  const before = Array.from({ length: random.between(0, 2) }, () => statement("i"));
  const after = Array.from({ length: random.between(2, 4) }, () => statement(counter()));
  const body = [
    "if (++t > 9) break;",
    ...before,
    ...(stepsInTheHead ? [] : [keepsTheOldValue ? `const p = ${goesDown ? "i--" : "i++"};` : `${stepped};`]),
    ...after,
  ];
  const head = random.chance(0.7)
    ? [`for (let i = ${startFrom}; ${test}; ${stepsInTheHead ? stepped : ""}) {`]
    : stepsInTheHead
      ? [`for (let i = ${startFrom}; ${test}; ${stepped}) {`]
      : [`let i = ${startFrom};`, `while (${test}) {`];
  const back = random.pick([
    "return [z, y, v];",
    "return [z, y, v];",
    "return [t, z, y, v].map(show).join();",
    "return [t, z, y, v].map(show).join();",
    "return t + 3 * z + 5 * y + 7 * v;",
    "return `${t} ${z} ${y} ${v}`;",
  ]);
  const object = "{ n: number; b: number; m: number[] }";
  // A parameter that the function does not read is not there: with two more written arguments at each call some faults no longer show.
  const takesA = startFrom === "a";
  const takesB = boundFrom === "b";
  const text = `function ${name}(L${as(kind)}, o${as(object)}${takesA ? `, a${as("number")}` : ""}${takesB ? `, b${as("number")}` : ""}) {
  let t = 0, z = 0, y = 0, v = 0;
  ${head.join("\n  ")}
    ${body.join("\n    ")}
  }
  ${back}
}
`;

  const made = (length: number) =>
    kind === "number[]" ? `[${Array.from({ length }, (_, at) => at + 4).join(", ")}]` : `new ${kind}(${length})`;
  const called = (n: number, limit: number) =>
    `((L${as(kind)}) => String(${name}(L, { n: ${n}, b: ${limit}, m: [${random.pick(["1", "1, 2", "0.5, 2"])}] }${takesA ? `, ${n}` : ""}${takesB ? `, ${limit}` : ""}))${random.chance(0.6) ? ' + "/" + String(L)' : ""})(${made(random.between(1, 5))})`;
  const atTheEdge = called(start, bound);
  const calls: string[] = [];
  if (random.chance(0.9)) calls.push(`String({ n: ${random.between(0, 9)}, b: 0, m: [5] }.n)`);
  if (random.chance(0.2)) calls.push(goesDown ? called(random.between(2, 6), 1) : called(1, random.between(2, 6)));
  if (random.chance(0.85)) calls.push(`[0, 1].map(() => ${atTheEdge}).join(";")`);
  else calls.push(atTheEdge, called(start, bound));
  if (random.chance(0.15)) {
    const other = random.pick(edges) + random.between(-2, 3);
    calls.push(called(other, goesDown ? other - turns * step : other + turns * step));
  }
  return { name, text, calls };
}

export function generate(random: Random, typed: boolean): string {
  const shapes = Array.from({ length: random.between(6, 12) }, (_, number) => shapeOf(random, `k${number}`, typed));
  return `${helpers(typed)}${shapes.map(shape => shape.text).join("")}${shapes
    .map(shape => `console.log("${shape.name}", [${shape.calls.join(", ")}].join(" "));`)
    .join("\n")}
${typed ? "export {};\n" : ""}`;
}
