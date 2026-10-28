// A loop counts, and each turn hands the counter to a call: the only call of that function in the program. The function is small or large, and it may change what the loop reads.
//
//   the counter   let or var, declared in the loop's head or in front of it; up or down; by ++, --, += a step, = itself + 1; for, while, do while; tested by <, <=, >, >=, !==
//   from, to      small whole numbers first, then the ends of the 32 bits and of the 53 bits, halves, -0, NaN, the infinities; where the bound has no type also a text, null, an object with valueOf, a BigInt
//   the bound     a parameter, a variable that a closure writes, a member of an object, the length of a list that the function makes longer or shorter
//   the call      by name, by a parameter, by a variable that holds one of two functions, as a method, through call, with a spread, with the counter twice, in a sum; or a built-in
//   the function  from one line to some hundred; writes to its parameter; keeps its arguments; has a default, a rest; declares closures; returns from inside a loop, a try, a switch; throws in one turn;
//                 written inside the loop's function it writes to the counter, the bound or the step
//   the loop's function  plain, a method, a generator that yields each answer, an async function that awaits each answer
//   then          the answers are folded, -0 told from 0; the turns are counted and end at 24; the counter is printed behind the loop
import type { Random } from "./random";

const prelude = `function fold(sum: number, value: unknown): number {
  const n = typeof value === "number" ? (Object.is(value, -0) ? 0.25 : value !== value ? 0.125 : value === Infinity ? 0.5 : value === -Infinity ? 0.75 : value) : String(value).length + 0.0625;
  return (sum * 31 + n) % 1000003;
}
function show(value: unknown): string {
  return Object.is(value, -0) ? "-0" : typeof value === "bigint" ? value + "n" : String(value);
}`;

const ascending: [string, string, string][] = [
  ["0", "10", "1"],
  ["-5", "5", "1"],
  ["-0", "3", "1"],
  ["0", "3.5", "1"],
  ["0.5", "4", "1"],
  ["0", "4", "0.5"],
  ["0", "NaN", "1"],
  ["NaN", "4", "1"],
  ["0", "Infinity", "1"],
  ["2147483640", "2147483647", "1"],
  ["2147483640", "2147483648", "1"],
  ["2147483640", "2147483655", "1"],
  ["2147483640", "2147483647", "3"],
  ["2147483646", "Infinity", "1"],
  ["-2147483650", "-2147483640", "1"],
  ["4294967290", "4294967300", "1"],
  ["1000000000", "5000000000", "1000000000"],
  ["0", "5", "2147483647"],
  ["0", "4294967296", "1073741824"],
  ["9007199254740988", "9007199254740994", "1"],
  ["-3", "-0", "1"],
  ["0", "0", "1"],
  ["5", "1", "1"],
  ["0", "6", "-0"],
];
const negated = (text: string) => (text === "NaN" ? text : text.startsWith("-") ? text.slice(1) : "-" + text);
const untypedBounds = [
  `"7"`,
  `"2147483650"`,
  `"x"`,
  `null`,
  `undefined`,
  `true`,
  `{ valueOf: () => 4 }`,
  `6n`,
  `[5]`,
  `2147483649n`,
];

/** Lines that only make a function larger. */
function ballast(random: Random, lines: number): string {
  return Array.from({ length: lines }, (_, k) =>
    random.pick([
      `  a = (a ^ (x + ${k})) >>> 0;`,
      `  a = (a + x * ${k + 3}) % 65521;`,
      `  if (a > ${k * 7 + 5}) a -= ${k + 1};`,
      `  a = Math.imul(a, ${2 * k + 3}) | 0;`,
      `  a += x > ${k} ? 1 : 2;`,
    ]),
  ).join("\n");
}

function scene(random: Random, index: number): string {
  const n = String(index);
  const isDown = random.chance(0.3);
  const isUntypedBound = random.chance(0.2);
  const number = ": number";
  const boundType = isUntypedBound ? ": any" : number;
  const inside = random.weighted([[6, "none"], [1, "counter"], [1, "bound"], [1, "step"]] as const); // prettier-ignore
  const boundKind = inside === "bound" ? "variable" : random.weighted([[5, "parameter"], [1, "variable"], [1, "member"], [1, "length"]] as const); // prettier-ignore
  const isInside = inside !== "none";
  const shape = random.weighted([[6, "plain"], [1, "method"], [1, "generator"], [1, "async"]] as const); // prettier-ignore

  // The function that the loop calls.
  const size = random.pick([0, 0, 1, 3, 6, 10, 16, 24, 36, 60]);
  const extra = random.weighted([
    [4, ""],
    [2, `  x++;\n  x *= 2;`],
    [1, `  x = x | 0;`],
    [1, `  a += arguments.length;\n  arguments[0] = 1;`],
    [1, `  const later = () => x + a;\n  kept${n}.push(later);`],
    [1, `  for (let k = 0; k < 4; k++) {\n    if (k + x === 5) return k;\n    a += k;\n  }`],
    [1, `  try {\n    if (x === 3) return a + 1;\n  } finally {\n    a += 2;\n  }`],
    [1, `  switch (x) {\n    case 1:\n      return 10;\n    case 2147483647:\n      return 20;\n    case 2:\n      a += 3;\n  }`],
    [1, `  if (x === 4 || x === 2147483646 || x === -4) throw new RangeError("turn " + show(x));`],
    [1, `  if (Object.is(x, -0)) return -0;`],
    [inside === "none" ? 1 : 0, `  let i = x;\n  i += 100;\n  a += i;`],
  ] as const); // prettier-ignore
  const touch =
    inside === "counter" ? `  if (x === ${isDown ? "-2" : "2"} || x === ${isDown ? "-2147483644" : "2147483644"}) i ${isDown ? "-=" : "+="} ${random.pick(["2", "1.5", "4294967296"])};`
    : inside === "bound" ? `  if (x === ${isDown ? "-2" : "2"}) limit = ${random.pick(["x", "x + 2.5", "NaN", isDown ? "-2147483660" : "2147483660"])};`
    : inside === "step" ? `  if (x === ${isDown ? "-2" : "2"}) step = ${random.pick(["2", "0.5", "1073741824"])};`
    : boundKind === "member" && random.chance(0.6) ? `  if (x === ${isDown ? "-3" : "3"}) limits${n}.to = ${random.pick(["x", "x + 1.5", "2147483652"])};`
    : boundKind === "length" && random.chance(0.7) ? `  if (x === 2) list${n}.${random.pick(["push(0, 0)", "pop()", "length = 3", "length = 12"])};`
    : ""; // prettier-ignore
  const parameters = random.weighted([[6, `x${number}`], [1, `x${number}, y${number} = x`], [1, `x${number}, ...rest: number[]`]] as const); // prettier-ignore
  const usesArguments = extra.includes("arguments");
  const answers = random.pick(["a + x", "x", "a", "x + 0.5", "-x", "x * 2", "x % 7", "1 / x"]);
  const bodyText = [`  let a = 1;`, touch, extra, ballast(random, size), `  return ${answers};`]
    .filter(line => line !== "")
    .join("\n");
  const calleeAsArrow = isInside && !usesArguments && random.chance(0.5);
  const callee = calleeAsArrow
    ? `const callee${n} = (${parameters})${number} => {\n${bodyText}\n};`
    : `function callee${n}(${parameters})${number} {\n${bodyText}\n}`;

  // The call.
  const call = random.weighted([
    [6, `callee${n}(i)`],
    [1, `callee${n}(i) + i`],
    [1, `callee${n}.call(null, i)`],
    [1, `callee${n}(...[i] as [number])`],
    [isInside ? 0 : 1, `called(i)`],
    [isInside ? 0 : 1, `either(i)`],
    [isInside ? 0 : 1, `holder${n}.member(i)`],
    [1, random.pick(["Math.abs(i)", "String(i)", "Math.fround(i)", "Number.isInteger(i)", "Object.is(i, -0)", "Math.clz32(i)", "(i).toString(16)", "Math.sign(i)", `"abcdefgh".charCodeAt(i)`, "[1, 2, 3, 4].at(i)", "Math.max(i, 2)", "Math.trunc(i)"])],
  ] as const); // prettier-ignore
  const isBuiltIn = !/callee|called|either|holder/.test(call);
  const awaited = shape === "async" ? "await " : "";
  const guarded = extra.includes("throw");
  const answer = shape === "generator" ? `yield ${call}` : `${awaited}${call}`;
  const turn =
    guarded && random.chance(0.6)
      ? `try {\n      sum = fold(sum, ${shape === "generator" ? `(${answer})` : answer});\n    } catch (error) {\n      sum = fold(sum, i);\n    }`
      : `sum = fold(sum, ${shape === "generator" ? `(${answer})` : answer});`;

  const bound =
    boundKind === "parameter"
      ? "to"
      : boundKind === "variable"
        ? "limit"
        : boundKind === "member"
          ? `limits${n}.to`
          : `list${n}.length`;
  const test = isDown ? random.pick([">", ">", ">=", "!=="]) : random.pick(["<", "<", "<", "<=", "<=", "!=="]);
  const stepKind = inside === "step" ? "by step" : random.weighted([[4, "one"], [2, "by step"], [1, "itself"], [1, "prefix"]] as const); // prettier-ignore
  const advance =
    stepKind === "one"
      ? isDown
        ? "i--"
        : "i++"
      : stepKind === "prefix"
        ? isDown
          ? "--i"
          : "++i"
        : stepKind === "itself"
          ? `i = i ${isDown ? "-" : "+"} 1`
          : `i ${isDown ? "-=" : "+="} step`;
  const keyword = random.pick(["let", "let", "var"]);
  const form = isInside ? "ahead" : random.weighted([[4, "head"], [2, "ahead"], [1, "while"], [1, "do"]] as const); // prettier-ignore
  const stop = `if (++turns >= 24) break;`;
  const loop =
    form === "head" ? `for (${keyword} i = from; i ${test} ${bound}; ${advance}) {\n    ${turn}\n    last = i;\n    ${stop}\n  }`
    : form === "ahead" ? `for (i = from; i ${test} ${bound}; ${advance}) {\n    ${turn}\n    ${stop}\n  }\n  last = i;`
    : form === "while" ? `i = from;\n  while (i ${test} ${bound}) {\n    ${turn}\n    ${advance};\n    ${stop}\n  }\n  last = i;`
    : `i = from;\n  do {\n    ${turn}\n    ${stop}\n  } while ((${advance}, i ${test} ${bound}));\n  last = i;`; // prettier-ignore
  const wrapped =
    guarded && !turn.startsWith("try")
      ? `try {\n  ${loop}\n  } catch (error) {\n    sum = fold(sum, (error as Error).message);\n  }`
      : loop;

  const head = `(from${number}, to${boundType}, step${number}, called: (x: number) => unknown)`;
  const inner = [
    `  let sum = 0;\n  let turns = 0;\n  let last: unknown = "none";`,
    form === "head" ? "" : `  ${keyword} i${number} = 0;`,
    boundKind === "variable" ? `  let limit${boundType} = to;` : boundKind === "member" ? `  limits${n}.to = to;` : boundKind === "length" ? `  list${n}.length = 0;\n  for (let k = 0; k < Math.min(Number(to) || 0, 9); k++) list${n}.push(k);` : "",
    call.startsWith("either") ? `  const either = from > 1 ? called : callee${n};` : "",
    isInside ? callee.replace(/^/gm, "  ") : "",
    `  ${wrapped}`,
    `  console.log("${n}", show(from), show(to), show(step), sum, turns, show(last));`,
  ].filter(line => line !== "").join("\n"); // prettier-ignore
  const drive =
    shape === "method" ? `class Driver${n} {\n  drive${head}: void {\n${inner}\n  }\n}\nconst driver${n} = new Driver${n}();`
    : shape === "generator" ? `function* drive${n}${head}: Generator<unknown, void, unknown> {\n${inner}\n}`
    : shape === "async" ? `async function drive${n}${head}: Promise<void> {\n${inner}\n}`
    : `function drive${n}${head}: void {\n${inner}\n}`; // prettier-ignore

  const handed = isInside || isBuiltIn || !/called|either/.test(call) ? `x => x` : `callee${n}`;
  const start = (from: string, to: string, step: string) => {
    const given = `(${from}, ${to}, ${step}, ${handed})`;
    return shape === "method"
      ? `driver${n}.drive${given};`
      : shape === "generator"
        ? `for (const each of drive${n}${given}) each;`
        : shape === "async"
          ? `await drive${n}${given};`
          : `drive${n}${given};`;
  };
  const rows = Array.from({ length: random.between(2, 5) }, (_, k) => {
    const [from, to, step] = k === 0 && random.chance(0.7) ? ascending[0] : random.pick(ascending);
    const bounded =
      isUntypedBound && k > 0 && random.chance(0.6) ? random.pick(untypedBounds) : isDown ? negated(to) : to;
    return start(isDown ? negated(from) : from, bounded, step);
  });
  return [
    extra.includes("kept") ? `const kept${n}: (() => number)[] = [];` : "",
    boundKind === "member" ? `const limits${n}: { to${boundType} } = { to: 0 };` : "",
    boundKind === "length" ? `const list${n}: number[] = [];` : "",
    isInside || isBuiltIn ? "" : callee,
    call.startsWith("holder") ? `const holder${n} = { member: callee${n} };` : "",
    drive,
    ...rows,
    extra.includes("kept") ? `console.log("${n} kept", kept${n}.length, kept${n}.slice(0, 6).map(one => show(one())).join());` : "",
  ].filter(line => line !== "").join("\n"); // prettier-ignore
}

export function generate(random: Random): string {
  return (
    [prelude, ...Array.from({ length: random.between(2, 5) }, (_, index) => scene(random, index)), "export {};"].join(
      "\n",
    ) + "\n"
  );
}
