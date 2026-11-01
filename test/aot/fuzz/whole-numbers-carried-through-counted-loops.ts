// `c = c > 0 ? d : c` in a counted loop: small, dense functions of whole numbers. Each has six number variables, three from its parameters
// and three from small constants, and carries all of them through one or two nested counted loops. In each turn there are two or three
// statements: a sum or an xor over Math.imul, Math.abs, Math.max and `&`, a choice between two different variables, or a swap by a
// temporary. Nothing is printed inside. A loop's bound is written or masked out of a parameter; by lot there is a label to leave by or
// a try with a finally. Every variable reaches the result, and every argument is written at the call, the edges of int32 and of 16 bits
// among them, so a compiler knows much about each variable where the ways meet, and a wrong conclusion changes the answer.
import type { Random } from "./random";

export interface Shape {
  name: string;
  text: string;
  calls: string[];
}

const locals = ["a", "b", "c", "d", "e", "f"];
const parameters = ["x", "y", "z"];
const small = [-1, 0, 1, 2, 3, 5, 7, 9];
const marks = [0, 1, 2, 3, 255, 32767, 65535, 65536, 2147483647];
const few = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 100, -1, -2, -7];
const edges = [
  255, 256, 32767, 32768, -32768, -32769, 65535, 65536, -65535, -65536, 2147483647, 2147483646, -2147483648,
  -2147483647, 1073741824, -1073741824,
];

export function helpers(typed: boolean): string {
  return `function show(v${typed ? ": unknown" : ""})${typed ? ": string" : ""} {
  return typeof v === "number" ? (Object.is(v, -0) ? "-0" : String(v)) : String(v);
}
`;
}

export function shapeOf(random: Random, name: string, typed: boolean): Shape {
  const number = typed ? ": number" : "";
  const other = (list: string[], not: string) => random.pick(list.filter(item => item !== not));
  const depth = random.chance(0.5) ? 2 : 1;
  const variable = (counters: string[]) => random.pick(random.chance(0.25) && counters.length ? counters : locals);
  const operand = (counters: string[]) => (random.chance(0.15) ? String(random.pick(small)) : variable(counters));
  const sum = (counters: string[]) => {
    const u = operand(counters);
    const v = operand(counters);
    const w = variable(counters);
    const value = random.pick([
      `Math.imul(${u}, ${v})`,
      `Math.abs(${w})`,
      `Math.max(${u}, ${v})`,
      `${w} & ${v}`,
      `(${w} + ${random.pick([0, 1, 2, -1])}) & ${v}`,
      `Math.imul(${u}, ${v}) & ${random.pick([255, 65535, 7])}`,
      `Math.max(${w}, ${v}) & ${u}`,
      `Math.abs(${w}) & ${v}`,
    ]);
    return `${random.pick(locals)} ${random.pick(["+=", "+=", "^="])} ${value};`;
  };
  // Where what follows runs only if the test held, an equality with a written number would narrow the variable to that number for the
  // type checker, which then refuses a later comparison with another number. There an equality is with another variable.
  const test = (counters: string[], narrows = false) => {
    const left = variable(counters);
    const compare = random.pick(["===", "==", "!==", "<", ">", "<=", ">="]);
    const withAVariable = random.chance(0.5) || (narrows && compare.includes("=="));
    return `${left} ${compare} ${withAVariable ? other([...locals, ...counters], left) : String(random.pick(marks))}`;
  };
  const choice = (counters: string[]) => {
    const first = variable(counters);
    return `${random.pick(locals)} = ${test(counters)} ? ${first} : ${other([...locals, ...counters], first)};`;
  };
  let temporaries = 0;
  const swap = () => {
    const first = random.pick(locals);
    const second = other(locals, first);
    const t = `t${temporaries++}`;
    return `{ const ${t} = ${first}; ${first} = ${second}; ${second} = ${t}; }`;
  };
  const statements = (counters: string[], count: number) => {
    const drawn = Array.from({ length: count }, () => random.pick([sum, sum, choice, choice, swap]));
    if (count > 1 && new Set(drawn).size === 1)
      drawn[count - 1] = random.pick([sum, choice, swap].filter(kind => kind !== drawn[0]));
    return drawn.map(kind => kind(counters));
  };
  const bound = () =>
    random.chance(0.5)
      ? String(random.pick([2, 3, 4, 5, 8, 9, 12]))
      : `(${random.pick(parameters)} & ${random.pick([3, 7, 15])}) + 1`;
  const loop = (i: string, label: string, body: string[]) => {
    const mark = label ? `${label}: ` : "";
    const limit = bound();
    switch (random.below(5)) {
      case 0:
        return [`${mark}for (let ${i} = ${random.below(2)}; ${i} < ${limit}; ${i}++) {`, ...body, "}"];
      case 1:
        return [`${mark}for (let ${i} = 1; ${i} <= ${limit}; ${i}++) {`, ...body, "}"];
      case 2:
        return [`${mark}for (let ${i} = ${limit}; ${i} > 0; ${i}--) {`, ...body, "}"];
      case 3:
        return [`let ${i} = 0;`, `${mark}while (${i} < ${limit}) {`, `${i}++;`, ...body, "}"];
      default:
        return [`let ${i} = 0;`, `${mark}while (${test([], true)} && ${i} < ${limit}) {`, `${i}++;`, ...body, "}"];
    }
  };
  const guarded = (lines: string[]) =>
    random.chance(0.2) && lines.length > 1
      ? ["try {", ...lines.slice(0, -1), "} finally {", lines[lines.length - 1], "}"]
      : lines;
  const labelled = depth === 2 && random.chance(0.25);
  let inner = statements(depth === 2 ? ["i0", "i1"] : ["i0"], random.between(2, 3));
  if (labelled)
    inner.splice(
      random.between(1, inner.length),
      0,
      `if (${test(["i0", "i1"], true)}) ${random.pick(["continue", "break"])} outer;`,
    );
  else inner = guarded(inner);
  let body = inner;
  if (depth === 2) {
    body = loop("i1", "", inner);
    if (random.chance(0.3)) body = [...statements(["i0"], 1), ...body];
    if (random.chance(0.3)) body = [...body, ...statements(["i0"], 1)];
  }
  const lines = [
    `let a${number} = x, b${number} = y, c${number} = z, d${number} = ${random.pick(small)}, e${number} = ${random.pick(small)}, f${number} = ${random.pick(small)};`,
    ...loop("i0", labelled ? "outer" : "", body),
    random.weighted([
      [6, "return a + 3 * b + 5 * c + 7 * d + 11 * e + 13 * f;"],
      [2, "return [a, b, c, d, e, f].map(show).join();"],
      [1, "return String([a, b, c, d, e, f]);"],
      [1, "return `${a} ${b} ${c} ${d} ${e} ${f}`;"],
    ] as const),
  ];
  let indent = 1;
  const laid = lines.map(line => {
    if (line.startsWith("}")) indent--;
    const text = "  ".repeat(indent) + line;
    if (line.endsWith("{")) indent++;
    return text;
  });
  const whole = () => random.pick(random.chance(0.55) ? few : edges);
  const calls = Array.from({ length: random.between(5, 8) }, () => `${name}(${whole()}, ${whole()}, ${whole()})`);
  return { name, text: `function ${name}(x${number}, y${number}, z${number}) {\n${laid.join("\n")}\n}\n`, calls };
}

export function generate(random: Random, typed: boolean): string {
  const shapes = Array.from({ length: random.between(6, 12) }, (_, number) => shapeOf(random, `k${number}`, typed));
  return `${helpers(typed)}${shapes.map(shape => shape.text).join("")}${shapes
    .map(shape => `console.log("${shape.name}", [${shape.calls.join(", ")}].join(" "));`)
    .join("\n")}
${typed ? "export {};\n" : ""}`;
}
