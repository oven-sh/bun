// Numbers that cross a border of their representation while typed code counts, sums and indexes with them: what a compiler proves about a range in front of a loop must hold at its last round too.
//
//   borders   the ends of int32 and uint32, 2**31, 2**32, 2**51, 2**52, 2**53 and their negatives, the ends of int8 | int16 | uint8 | uint16, zero from both sides (-0), the largest array index and length, the largest finite number
//   walks     a counter that steps over the border by 1, 2, 3, 7, a power of two, a fraction; upward and downward; `<`, `<=`, `!==`, a bound that is itself at the border; products, shifts and squares that leave the range;
//             sums of many small numbers and of a few large ones; two counters that meet; a counter that is also an index, an offset, a divisor, a shift count, a length
//   kept in   a variable, a parameter, a field of a class, an element of an array of numbers, of each kind of typed array, a captured variable, a variable that lives across a yield or an await, `number | undefined`
//   read by   + - * / % ** << >> >>> & | ^ ~, comparisons, Math.floor | ceil | round | trunc | abs | sign | min | max | imul | clz32 | fround, indexes, String, toString(2), Object.is, switch, BigInt, Number.isSafeInteger | isInteger
//
// Each walk starts a few steps in front of the border and ends a few steps behind it, and prints every value it passes.
import type { Random } from "./random";

const prelude = `function show(x: number | undefined): string {
  return x === undefined ? "u" : Object.is(x, -0) ? "-0" : String(x);
}
class Cell {
  n: number;
  m: number;
  constructor(n: number, m: number) {
    this.n = n;
    this.m = m;
  }
  step(by: number): number {
    this.n += by;
    return this.n;
  }
}
const small: number[] = Array.from({ length: 40 }, (_, i) => i * 10);
function opaque(x: number): number {
  return [x][small[0]];
}`;

const borders: [string, string][] = [
  ["int32-max", "2147483647"],
  ["int32-min", "-2147483648"],
  ["uint32-max", "4294967295"],
  ["two-to-32", "4294967296"],
  ["minus-two-to-32", "-4294967296"],
  ["two-to-30", "1073741824"],
  ["two-to-51", "2251799813685248"],
  ["minus-two-to-51", "-2251799813685248"],
  ["two-to-52", "4503599627370496"],
  ["two-to-53", "9007199254740992"],
  ["minus-two-to-53", "-9007199254740992"],
  ["zero", "0"],
  ["int8-max", "127"],
  ["uint8-max", "255"],
  ["int16-max", "32767"],
  ["uint16-max", "65535"],
  ["int16-min", "-32768"],
  ["largest-index", "4294967294"],
  ["two-to-31-and-a-half", "2147483647.5"],
  ["root-of-int32", "46340"],
  ["root-of-two-to-53", "94906265"],
];
const steps = ["1", "2", "3", "7", "16", "0.5", "1.5", "65536", "1000003"];

// `x` is the number at this step, of type number.
const reads: string[] = [
  "x",
  "x + 1",
  "x - 1",
  "x + x",
  "x * 2",
  "x * 3",
  "x * x",
  "x * -1",
  "-x",
  "x / 2",
  "x / -1",
  "x % 2",
  "x % 7",
  "x % -3",
  "-x % 5",
  "x ** 2",
  "x | 0",
  "x >>> 0",
  "x >> 1",
  "x >>> 1",
  "x << 1",
  "x << 31",
  "1 << x",
  "x & 0xffff",
  "x & -1",
  "x ^ -1",
  "~x",
  "~~x",
  "(x | 0) + 1",
  "((x | 0) + 1) | 0",
  "(x >>> 0) + 1",
  "((x >>> 0) + 1) >>> 0",
  "(x | 0) * (x | 0)",
  "(x | 0) - 2147483647",
  "-(x | 0)",
  "(x | 0) / -1",
  "(x | 0) % -1",
  "Math.abs(x | 0)",
  "Math.abs(x)",
  "Math.floor(x / 2)",
  "Math.floor(x / 3) * 3",
  "Math.ceil(x / 2)",
  "Math.round(x / 2)",
  "Math.round(x - 0.5)",
  "Math.trunc(x / 7)",
  "Math.sign(x)",
  "Math.min(x, 2147483647)",
  "Math.max(x, -2147483648)",
  "Math.min(x, -0)",
  "Math.max(x, 0)",
  "Math.imul(x, 3)",
  "Math.imul(x, x)",
  "Math.clz32(x)",
  "Math.fround(x)",
  "Math.sqrt(x * x)",
  "Math.hypot(x, 0)",
  "x + 0.5 - 0.5",
  "x + 1 - 1",
  "(x + 1) - x",
  "x + 1 > x ? 1 : 0",
  "x < 2147483648 ? 1 : 0",
  "x <= 2147483647 ? 1 : 0",
  "x >= -2147483648 ? 1 : 0",
  "x === (x | 0) ? 1 : 0",
  "x === x >>> 0 ? 1 : 0",
  "x == 0 ? 1 : 0",
  "Object.is(x, 0) ? 1 : 0",
  "Object.is(x * 0, -0) ? 1 : 0",
  "1 / (x * 0)",
  "1 / x",
  "Number.isSafeInteger(x) ? 1 : 0",
  "Number.isInteger(x) ? 1 : 0",
  "Number.isSafeInteger(x + 1) ? 1 : 0",
  "String(x).length",
  "x.toString(2).length",
  "Number(String(x))",
  "parseInt(String(x))",
  "Number(BigInt(Math.trunc(x)) + 1n)",
  "Number(BigInt.asIntN(32, BigInt(Math.trunc(x))))",
  "Number(BigInt.asUintN(32, BigInt(Math.trunc(x))))",
  "small[x & 31]",
  "small[x - BORDER + 8] ?? -1",
  "small[(x - BORDER + 8) | 0] ?? -1",
  "small[x] ?? -1",
  "small[x >>> 28] ?? -1",
  "small.at(x - BORDER) ?? -1",
  "small.indexOf(x - BORDER)",
  "small.slice(x - BORDER).length",
  '"abcdefghijklmnop".charCodeAt(x - BORDER + 8)',
  '"abcdefghijklmnop".slice(x - BORDER).length',
  "new Int32Array([x])[0]",
  "new Uint32Array([x])[0]",
  "new Int8Array([x])[0]",
  "new Uint8ClampedArray([x])[0]",
  "new Int16Array([x])[0]",
  "new Float32Array([x])[0]",
  "new Float64Array([x])[0]",
  "(() => {\n      switch (x) {\n        case 2147483647:\n          return 1;\n        case 2147483648:\n          return 2;\n        case -2147483648:\n          return 3;\n        case 0:\n          return 4;\n        case 4294967295:\n          return 5;\n        case 4294967296:\n          return 6;\n        default:\n          return 0;\n      }\n    })()",
  "(() => {\n      switch (x | 0) {\n        case 2147483647:\n          return 1;\n        case -2147483648:\n          return 2;\n        case -1:\n          return 3;\n        case 0:\n          return 4;\n        default:\n          return 0;\n      }\n    })()",
];

// `START`, `END`, `BY` are literals or parameters; `READ` prints; the walk goes upward. `DOWN` forms go the other way.
const walks: Record<string, { text: string; isAsync?: boolean; isGenerator?: boolean }> = {
  "for-less": { text: "for (let x = START; x < END && turns++ < 40; x += BY) {\n    READ\n  }" },
  "for-less-or-equal": { text: "for (let x = START; x <= END && turns++ < 40; x += BY) {\n    READ\n  }" },
  "for-increment": { text: "let rounds = 0;\n  for (let x = START; x < END && rounds < 40; x++, rounds++) {\n    READ\n  }" },
  "for-down": { text: "for (let x = END; x > START && turns++ < 40; x -= BY) {\n    READ\n  }" },
  "for-down-or-equal": { text: "for (let x = END; x >= START && turns++ < 40; x -= BY) {\n    READ\n  }" },
  "for-decrement": { text: "let rounds = 0;\n  for (let x = END; x > START && rounds < 40; x--, rounds++) {\n    READ\n  }" },
  "while-counted": { text: "let x = START;\n  for (let i = 0; i < COUNT; i++) {\n    READ\n    x += BY;\n  }" },
  "while-counted-down": { text: "let x = END;\n  for (let i = 0; i < COUNT; i++) {\n    READ\n    x -= BY;\n  }" },
  "from-the-counter": { text: "for (let i = 0; i < COUNT; i++) {\n    const x = START + i * BY;\n    READ\n  }" },
  "from-the-counter-down": { text: "for (let i = COUNT; i > 0; i--) {\n    const x = END - i * BY;\n    READ\n  }" },
  "do-while": { text: "let x = START;\n  do {\n    READ\n    x += BY;\n  } while (x < END && turns++ < 40);" },
  "two-counters": { text: "for (let x = START, y = END; x < y && turns++ < 40; x += BY, y -= BY) {\n    READ\n    out += show(y) + \" \";\n  }" },
  doubling: { text: "let x = Math.trunc(START / 8) || 1;\n  for (let i = 0; i < 8; i++) {\n    READ\n    x *= 2;\n  }" },
  "doubling-by-adding": { text: "let x = Math.trunc(START / 8) || 1;\n  for (let i = 0; i < 8; i++) {\n    READ\n    x += x;\n  }" },
  "summing-the-step": { text: "let x = START;\n  for (const more of [BY, BY, BY * 2, BY, BY * 3, BY, BY, BY * 5, BY]) {\n    READ\n    x += more;\n  }" },
  "in-a-field": { text: "const cell = new Cell(START, 0);\n  for (let i = 0; i < COUNT; i++) {\n    const x = cell.n;\n    READ\n    cell.n += BY;\n  }" },
  "in-a-field-by-a-method": { text: "const cell = new Cell(START, 0);\n  for (let i = 0; i < COUNT; i++) {\n    const x = cell.step(BY);\n    READ\n  }" },
  "in-an-element": { text: "const kept: number[] = [1, START, 3];\n  for (let i = 0; i < COUNT; i++) {\n    const x = kept[1];\n    READ\n    kept[1] += BY;\n  }" },
  "pushed-to-a-list": { text: "const kept: number[] = [];\n  for (let i = 0; i < COUNT; i++) kept.push(START + i * BY);\n  for (const x of kept) {\n    READ\n  }" },
  "in-a-float64-array": { text: "const kept = new Float64Array([START]);\n  for (let i = 0; i < COUNT; i++) {\n    const x = kept[0];\n    READ\n    kept[0] += BY;\n  }" },
  "in-an-int32-array": { text: "const kept = new Int32Array([START]);\n  for (let i = 0; i < COUNT; i++) {\n    const x = kept[0];\n    READ\n    kept[0] += BY;\n  }" },
  "in-a-uint32-array": { text: "const kept = new Uint32Array([START]);\n  for (let i = 0; i < COUNT; i++) {\n    const x = kept[0];\n    READ\n    kept[0] += BY;\n  }" },
  "in-a-uint8-array": { text: "const kept = new Uint8Array([START]);\n  for (let i = 0; i < COUNT; i++) {\n    const x = kept[0];\n    READ\n    kept[0] += BY;\n  }" },
  captured: { text: "let x = START;\n  const advance = () => {\n    x += BY;\n  };\n  for (let i = 0; i < COUNT; i++) {\n    READ\n    advance();\n  }" },
  optional: { text: "let held: number | undefined = COUNT > 100 ? undefined : START;\n  for (let i = 0; i < COUNT; i++) {\n    const x = held ?? 0;\n    READ\n    held = i === COUNT - 2 ? undefined : x + BY;\n  }" },
  recursion: { text: "const go = (x: number, left: number): void => {\n    if (left === 0) return;\n    READ\n    go(x + BY, left - 1);\n  };\n  go(START, COUNT);" },
  "reduce": { text: "new Array<number>(COUNT).fill(BY).reduce((x, more) => {\n    READ\n    return x + more;\n  }, START);" },
  "across-a-wait": { text: "for (let x = START; x < END && turns++ < 40; x += BY) {\n    await null;\n    READ\n  }", isAsync: true },
  "across-a-yield": { text: "function* values(): Generator<number, void, unknown> {\n    for (let x = START; x < END && turns++ < 40; x += BY) yield x;\n  }\n  for (const x of values()) {\n    READ\n  }" },
};

export function generate(random: Random): string {
  const names: string[] = [];
  const text: string[] = [prelude];
  const calls: string[] = [];
  const scenes = random.between(5, 10);
  for (let id = 1; id <= scenes; id++) {
    const [borderName, border] = random.pick(borders);
    const by = random.pick(steps);
    const walkName = random.pick(Object.keys(walks));
    const walk = walks[walkName];
    const count = random.between(8, 16);
    const value = Number(border);
    const ahead = random.between(2, count - 2);
    const start = value - ahead * Number(by);
    const end = start + count * Number(by);
    const chosen = random.sample(reads, random.between(1, 4));
    // A literal that the compiler sees, a parameter that every caller gives alike, or a number it cannot follow.
    const given = random.pick(["literals", "parameters", "opaque"]);
    const literal = (x: number) => (Object.is(x, -0) ? "-0" : x < 0 ? `(${x})` : String(x));
    const names3 = given === "literals" ? [literal(start), literal(end), by] : ["start", "end", "by"];
    const read = chosen.map(each => `out += show(${each.replaceAll("BORDER", () => literal(value))}) + " ";`).join("\n    ");
    names.push([borderName, by, walkName, given, chosen.length].join("-"));
    const body = walk.text
      .replaceAll("READ", () => read)
      .replaceAll("START", names3[0])
      .replaceAll("END", names3[1])
      .replaceAll("COUNT", String(count))
      .replace(/\bBY\b/g, names3[2]);
    const wrap = (x: string) => (given === "opaque" ? `opaque(${x})` : x);
    text.push(`${walk.isAsync ? "async " : ""}function walk${id}(${given === "literals" ? "" : "start: number, end: number, by: number"}): ${walk.isAsync ? "Promise<string>" : "string"} {
  let out = "";
  let turns = 0;
  ${body}
  return out;
}`);
    calls.push(`console.log("${id}: " + ${walk.isAsync ? "(await " : "("}walk${id}(${given === "literals" ? "" : [literal(start), literal(end), by].map(wrap).join(", ")})));`);
  }
  text.push(calls.join("\n"));
  return `// ${names.join(" ")}\n${text.join("\n")}`;
}
