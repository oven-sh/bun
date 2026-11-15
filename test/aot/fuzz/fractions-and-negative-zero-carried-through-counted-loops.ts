// `b = Math.round(a * 0.5); c = -c; d = e % 3` in a counted loop: small, dense functions of numbers that need not be whole. Each has six
// number variables, three from its parameters and three from constants, and carries all of them through one or two nested counted loops.
// In each turn there are two or three statements: a sum over a division, a remainder, a rounding, a shift or a conversion to 32 bits; a
// choice between two different variables, under a test that may ask for -0 or NaN; a swap; or a switch over two bits with a case that
// falls through. A compiler that keeps a variable as an integer must know where a fraction, -0, NaN or a number past 2 ** 31 can enter
// it. Every variable reaches the result in a way that tells -0 from 0, and every argument is written at the call.
import type { Random } from "./random";

export interface Shape {
  name: string;
  text: string;
  calls: string[];
}

const locals = ["a", "b", "c", "d", "e", "f"];
const parameters = ["x", "y", "z"];
const starts = ["0", "1", "2", "-1", "0.5", "-0", "1.5", "3", "7", "-2.5"];
const marks = ["0", "1", "0.5", "-1", "2", "255", "2147483647", "-2147483648", "4294967295"];
const few = ["0", "1", "2", "3", "4", "5", "7", "9", "12", "-1", "-2", "-7"];
const odd = [
  "-0",
  "0.5",
  "-0.5",
  "1.5",
  "2.25",
  "-3.75",
  "2147483647",
  "2147483648",
  "-2147483648",
  "-2147483649",
  "4294967295",
  "4294967296",
  "1073741824",
  "9007199254740991",
  "1e-7",
  "1e21",
  "NaN",
  "Infinity",
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
  const value = (counters: string[]) => {
    const u = variable(counters);
    const v = variable(counters);
    // A quotient of two whole numbers that is rounded at once can be an integer division, if the divisor cannot be 0 or negative.
    if (random.chance(0.25)) {
      const whole = (name: string) =>
        random.pick([`(${name} | 0)`, `(${name} & 255)`, ...(counters.length ? [random.pick(counters)] : [])]);
      const divisor = random.pick([
        "-2",
        "-3",
        "3",
        `((${v} & 3) - 1)`,
        `((${v} & 7) - 4)`,
        ...(counters.length ? [`(${random.pick(counters)} - 2)`] : []),
      ]);
      const quotient = `${whole(u)} / ${divisor}`;
      return random.pick([
        `Math.floor(${quotient})`,
        `Math.floor(${quotient})`,
        `Math.round(${quotient})`,
        `Math.trunc(${quotient})`,
        `Math.ceil(${quotient})`,
        `(${quotient}) | 0`,
      ]);
    }
    return random.pick([
      `${u} / ${random.pick(["2", "4", "3", "-2", "0.5"])}`,
      `${u} * ${random.pick(["0.5", "-1", "0.25", "-0"])}`,
      `Math.floor(${u} / ${random.pick(["2", "3", "4"])})`,
      `Math.round(${u} * 0.5)`,
      `Math.trunc(${u} / 3)`,
      `Math.ceil(${u} / 4)`,
      `Math.sign(${u})`,
      `Math.min(${u}, ${v})`,
      `Math.max(${u}, ${v})`,
      `${u} % ${random.pick(["3", "7", "-3", "2.5", "2"])}`,
      `${u} % ${v}`,
      `-${u}`,
      `${u} | 0`,
      `${u} >>> 0`,
      `${u} >> ${random.pick([1, 2, 31])}`,
      `${u} << ${random.pick([1, 4, 31])}`,
      `${u} >>> ${random.pick([1, 16, 31])}`,
      `~${u}`,
      `Math.abs(${u})`,
      `Math.fround(${u})`,
      `${u} - ${v}`,
      `${u} * ${v} % 1000`,
    ]);
  };
  const sum = (counters: string[]) =>
    `${random.pick(locals)} ${random.pick(["=", "=", "+=", "-="])} ${value(counters)};`;
  // Where what follows runs only if the test held, an equality with a written number would narrow the variable to that number for the
  // type checker, which then refuses a later comparison with another number. There an equality is with another variable.
  const test = (counters: string[], narrows = false) => {
    const left = variable(counters);
    if (random.chance(0.3))
      return random.pick([
        `Object.is(${left}, -0)`,
        `${left} !== ${left}`,
        `1 / ${left} < 0`,
        `Number.isInteger(${left})`,
        `${left} > 0.5`,
      ]);
    const compare = random.pick(["===", "==", "!==", "<", ">", "<=", ">="]);
    const withAVariable = random.chance(0.5) || (narrows && compare.includes("=="));
    return `${left} ${compare} ${withAVariable ? other([...locals, ...counters], left) : random.pick(marks)}`;
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
  const byTwoBits = (counters: string[]) => {
    const l = random.pick(locals);
    const ends = () => (random.chance(0.7) ? " break;" : "");
    return `switch (${variable(counters)} & 3) { case 0: ${l} = ${value(counters)};${ends()} case 1: ${sum(counters)}${ends()} case 2: ${l} = -${l}; break; default: ${sum(counters)} }`;
  };
  const statements = (counters: string[], count: number) => {
    const drawn = Array.from({ length: count }, () => random.pick([sum, sum, sum, choice, choice, swap, byTwoBits]));
    if (count > 1 && new Set(drawn).size === 1)
      drawn[count - 1] = random.pick([sum, choice, swap].filter(kind => kind !== drawn[0]));
    return drawn.map(kind => kind(counters));
  };
  const bound = () =>
    random.chance(0.5)
      ? String(random.pick([2, 3, 4, 5, 8, 9]))
      : `(${random.pick(parameters)} & ${random.pick([3, 7])}) + 1`;
  const loop = (i: string, body: string[]) => {
    const limit = bound();
    switch (random.below(4)) {
      case 0:
        return [`for (let ${i} = ${random.below(2)}; ${i} < ${limit}; ${i}++) {`, ...body, "}"];
      case 1:
        return [`for (let ${i} = ${limit}; ${i} > 0; ${i}--) {`, ...body, "}"];
      case 2:
        return [`let ${i} = 0;`, `while (${i} < ${limit}) {`, `${i}++;`, ...body, "}"];
      default:
        return [`let ${i} = 0;`, `while (${test([], true)} && ${i} < ${limit}) {`, `${i}++;`, ...body, "}"];
    }
  };
  let body = statements(depth === 2 ? ["i0", "i1"] : ["i0"], random.between(2, 3));
  if (depth === 2) {
    body = loop("i1", body);
    if (random.chance(0.3)) body = [...statements(["i0"], 1), ...body];
    if (random.chance(0.3)) body = [...body, ...statements(["i0"], 1)];
  }
  const lines = [
    `let a${number} = x, b${number} = y, c${number} = z, d${number} = ${random.pick(starts)}, e${number} = ${random.pick(starts)}, f${number} = ${random.pick(starts)};`,
    ...loop("i0", body),
    random.weighted([
      [6, "return [a, b, c, d, e, f].map(show).join();"],
      [2, "return show(a + 3 * b + 5 * c + 7 * d + 11 * e + 13 * f);"],
      [1, "return [1 / a, 1 / b, 1 / c, 1 / d, 1 / e, 1 / f].join();"],
    ] as const),
  ];
  let indent = 1;
  const laid = lines.map(line => {
    if (line.startsWith("}")) indent--;
    const text = "  ".repeat(indent) + line;
    if (line.endsWith("{")) indent++;
    return text;
  });
  const given = () => random.pick(random.chance(0.5) ? few : odd);
  const calls = Array.from({ length: random.between(5, 8) }, () => `${name}(${given()}, ${given()}, ${given()})`);
  return { name, text: `function ${name}(x${number}, y${number}, z${number}) {\n${laid.join("\n")}\n}\n`, calls };
}

export function generate(random: Random, typed: boolean): string {
  const shapes = Array.from({ length: random.between(6, 12) }, (_, number) => shapeOf(random, `k${number}`, typed));
  return `${helpers(typed)}${shapes.map(shape => shape.text).join("")}${shapes
    .map(shape => `console.log("${shape.name}", [${shape.calls.join(", ")}].join(" "));`)
    .join("\n")}
${typed ? "export {};\n" : ""}`;
}
