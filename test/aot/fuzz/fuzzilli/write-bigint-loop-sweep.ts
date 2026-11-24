// BigInts in loops: what goes in, times the operation, times the other operand, times how the answer goes on, times where the values come from.
//
//   bun write-bigint-loop-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<value>--<operation>--<other>--<step>--<source>.ts or .mjs
//   bun write-bigint-loop-sweep.ts count
import { mkdirSync, writeFileSync } from "node:fs";

const values: [name: string, text: string][] = [
  ["zero", "0n"],
  ["one", "1n"],
  ["minus-one", "-1n"],
  ["ten", "10n"],
  ["int32", "2147483647n"],
  ["past-int32", "2147483648n"],
  ["lowest-int32", "-2147483648n"],
  ["uint32", "4294967295n"],
  ["safe", "9007199254740991n"],
  ["past-safe", "-9007199254740993n"],
  ["int64", "9223372036854775807n"],
  ["past-int64", "9223372036854775808n"],
  ["lowest-int64", "-9223372036854775808n"],
  ["uint64", "18446744073709551615n"],
  ["two-words", "18446744073709551616n"],
  ["large", "10n ** 30n"],
  ["large-negative", "-(10n ** 40n)"],
];
// `a` and `b` are the operands.
const operations: [name: string, text: string][] = [
  ["plus", "a + b"],
  ["minus", "a - b"],
  ["times", "a * b"],
  ["divided", "a / b"],
  ["remainder", "a % b"],
  ["power", "a ** (b & 3n)"],
  ["and", "a & b"],
  ["or", "a | b"],
  ["xor", "a ^ b"],
  ["left", "a << (b & 70n)"],
  ["right", "a >> (b & 70n)"],
  ["left-negative", "a << -(b & 7n)"],
  ["not", "~a"],
  ["negated", "-a"],
  ["increment", "((a) => ++a)(a)"],
  ["decrement", "((a) => a--)(a)"],
  ["as-int", "BigInt.asIntN(64, a + b)"],
  ["as-uint", "BigInt.asUintN(64, a * b)"],
  ["as-int32", "BigInt.asIntN(32, a)"],
  ["as-uint8", "BigInt.asUintN(8, a - b)"],
  ["largest", "a > b ? a : b"],
  ["chosen", "a ? a : b"],
  ["square-sum", "a * a + b"],
  ["mixed", "(a + b) * (a - b)"],
  ["through-number", "BigInt(Number(BigInt.asIntN(50, a)))"],
  ["through-text", "BigInt(String(a)) + b"],
  ["hash", "BigInt.asUintN(32, a * 31n + b)"],
  ["throws", "a + (b as any as number)"],
];
// `x` is the answer, `a` goes on.
const steps: [name: string, text: string][] = [
  ["kept", "a = x;"],
  ["summed", "sum += x;"],
  ["counted", "if (x > 5n) turns++;"],
  ["compared-with-number", "if (x < 100) turns++;\nif (x == 0) turns += 2;"],
  ["equal", "if (x === a) turns++;\na = x;"],
  ["to-number", "total += Number(x);\na += 1n;"],
  ["to-text", "text += x;\na = b;"],
  ["swapped", "[a, b] = [x, a];"],
  ["truth", "if (x) turns++;\na -= 1n;"],
  ["element", "list.push(x);\na = list[list.length >> 1];"],
  ["typed", "view[turns & 1] = x;\na = view[0];\nturns++;"],
  ["kind", 'turns += typeof x === "bigint" ? 1 : 0;\na = x;'],
  ["sorted", "list.push(x);\nlist.sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));"],
  ["key", "seen.add(x);\na = x + 1n;"],
  ["negated-again", "a = -x;"],
  ["small", "a = x % 1000n;"],
];
const sources: [name: string, text: string][] = [
  ["loop", "for (let i = 0; i < n; i++) {\n  BODY\n}"],
  ["bigint-counter", "for (let i = 0n; i < 4n; i++) {\n  b = b + i;\n  BODY\n}"],
  ["from-a-list", "for (const b of [VALUE, 3n, -4n, 1n]) {\n  BODY\n}"],
  ["parsed", "for (let i = 0; i < n; i++) {\n  b = BigInt(String(i + 1));\n  BODY\n}"],
  ["captured", "const step = () => {\n  BODY\n};\nfor (let i = 0; i < n; i++) step();"],
  ["tried", "for (let i = 0; i < n; i++) {\n  try {\n    BODY\n  } catch (error) {\n    text += error.name;\n  }\n}"],
  ["growing", "for (let i = 0; i < 70; i++) {\n  if (a > 10n ** 60n || a < -(10n ** 60n)) break;\n  BODY\n}"],
];
const total = values.length * operations.length * values.length * steps.length * sources.length;

function write(cell: number): { name: string; text: string } {
  let rest = cell;
  const pick = <T>(from: readonly T[]): T => {
    const picked = from[rest % from.length];
    rest = Math.floor(rest / from.length);
    return picked;
  };
  const value = pick(values);
  const operation = pick(operations);
  const other = pick(values);
  const step = pick(steps);
  const source = pick(sources);
  const isTyped = cell % 2 === 1;
  const indent = (text: string, by: string) => text.split("\n").map(line => by + line).join("\n"); // prettier-ignore
  const type = (text: string) => (isTyped ? text : "");
  // A sum of a BigInt and a number throws.
  const asked =
    operation[0] === "throws"
      ? isTyped
        ? "(a as any) + 1"
        : "a + 1"
      : isTyped
        ? operation[1].replaceAll("((a) =>", "((a: bigint) =>")
        : operation[1];
  const body = source[1]
    .replace("BODY", () => `const x${type(": bigint")} = ${asked};\n${step[1]}`)
    .replace("VALUE", () => other[1]);
  const typed = isTyped
    ? body.replaceAll("x < 100", "(x as any) < 100").replaceAll("x == 0", "(x as any) == 0").replace("catch (error)", "catch (error: any)")
    : body; // prettier-ignore
  // A list of its own hides `b`.
  const hidesB = source[0] === "from-a-list";
  const lines = [
    "const notes = [] as any[];".replace(" as any[]", type(" as any[]")),
    `function work(a${type(": bigint")}, b${type(": bigint")}, n${type(": number")})${type(": any")} {`,
    "  let sum = 0n;",
    "  let turns = 0;",
    "  let total = 0;",
    '  let text = "";',
    `  const list${type(": bigint[]")} = [];`,
    "  const view = new BigInt64Array(2);",
    `  const seen = new Set${type("<bigint>")}();`,
    indent(hidesB ? typed.replace("[a, b] = [x, a];", "a = x;") : typed, "  "),
    '  return [a, sum, turns, total, text.slice(0, 80), list.length > 6 ? list.length : list.join(), view.join(), seen.size].join("|").slice(0, 300);',
    "}",
    "for (const n of [4, 1, 9]) {",
    "  try {",
    `    notes.push(work(${value[1]}, ${other[1]}, n));`,
    "  } catch (error) {",
    `    notes.push((error${type(" as any")}).name);`,
    "  }",
    "}",
    'console.log(notes.join(" "));',
    ...(isTyped ? ["export {};"] : []),
  ]; // prettier-ignore
  return {
    name: `${value[0]}--${operation[0]}--${other[0]}--${step[0]}--${source[0]}.${isTyped ? "ts" : "mjs"}`,
    text: lines.join("\n") + "\n",
  };
}

const padNumber = (index: number) => String(index).padStart(6, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(`${folder}/${padNumber(index)}-${program.name}`, program.text);
  }
  console.log(Math.min(count, total));
}
