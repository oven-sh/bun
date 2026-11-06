// Programs that put constant expressions in the places where a value that was folded at build time comes out: the left of `??`, `||` and `&&`, a
// template, `"" +`, a condition, a `const` that is then printed, and in TypeScript an enum member. The expressions are numbers as text, every
// arithmetic and bitwise operator on unusual operands, comparisons, concatenation and `String.raw`.
//
// A program is a seed. The same seed always writes the same program.
import { randomFrom } from "./constant-expressions";

// prettier-ignore
const special = ["0", "-0", "1", "-1", "0.1", "0.2", "0.3", "0.5", "1.5", "4.35", "1e21", "1e-7", "1.5e-7", "0.000001", "0.0000001", "123456789012345680000", "100000000000000000000", "999999999999999900000", "1e300", "-1e300", "5e-324", "2.2250738585072014e-308", "1.7976931348623157e308", "9007199254740991", "9007199254740992", "9007199254740993", "2147483647", "2147483648", "-2147483648", "-2147483649", "4294967295", "4294967296", "4294967297", "1e10", "123456.789", "0.1234567890123456789", "1.0000000000000002", "0.30000000000000004", "1e23", "8.41e21", "2e-7", "1.7e-6", "255", "65535", "31", "32", "33", "63", "64", "NaN", "Infinity", "-Infinity", "3", "7", "10", "100", "1000", "-7", "-0.5", "2.5", "-2.5", "1e15", "1e16", "1e17", "12345678901234567890", "0.000123", "5e-7", "9.5e-7", "1.2345e-10", "6.02214076e23", "1.602176634e-19"];
const strings = ['""', '"a"', '"0"', '" "', '"é"', '"\\n"', '"😀"', '"\\u0000"', '"NaN"', "`t`", "'q'"];
const others = ["true", "false", "null", "undefined"];

export function program(seed: number, isTypeScript: boolean): { file: string; text: string } {
  const { next, choice, upTo } = randomFrom(seed);
  const times = <T>(count: number, make: () => T) => Array.from({ length: count }, make);
  const inParentheses = (text: string) => "(" + text + ")";
  const anyDouble = (): string => {
    for (;;) {
      const value = new Float64Array(new Uint32Array([Math.floor(next() * 4294967296), Math.floor(next() * 4294967296)]).buffer)[0];
      if (Number.isFinite(value)) return String(value);
    }
  };
  const numbers = [
    ...special,
    ...times(260, anyDouble),
    ...times(80, () => String(Number(((next() * 2 - 1) * 1e6).toFixed(upTo(0, 9))))),
    ...times(80, () => `${upTo(1, 9)}e${upTo(-30, 30)}`),
    ...times(40, () => String(BigInt(Math.floor((next() * 2 - 1) * 2 ** 52)) * 256n + BigInt(upTo(0, 255)))),
  ];
  const unusual = [...special, ...times(10, anyDouble)];
  const operand = () => inParentheses(choice(unusual));
  const expressions = numbers.map(inParentheses);
  for (const operator of ["+", "-", "*", "/", "%", "**", "&", "|", "^", "<<", ">>", ">>>"]) expressions.push(...times(420, () => `(${operand()} ${operator} ${operand()})`));
  // In TypeScript `a < ((b) > (c))` is read as type arguments.
  for (const operator of ["<", "<=", ">", ">=", "==", "!=", "===", "!=="]) if (!isTypeScript || !operator.startsWith("<")) expressions.push(...times(60, () => `(${operand()} ${operator} ${operand()})`));
  for (const operator of ["-", "+", "~", "!", "- -", "~~", "!!"]) expressions.push(...times(40, () => `(${operator}${operand()})`));
  expressions.push(...times(300, () => inParentheses(times(upTo(2, 4), () => choice([choice(strings), operand(), choice(strings)])).join(" + "))));
  const substituted = () => choice([operand(), choice(strings), choice(others), `(${operand()} ${choice(["+", "*", "/", "%", "|", ">>>"])} ${operand()})`]);
  expressions.push(...times(200, () => "`" + times(upTo(1, 3), () => choice(["", "a", " ", "-", "\\n", "$", "{"]) + "${" + substituted() + "}").join("") + "`"));
  expressions.push(...times(60, () => "String.raw`" + times(upTo(1, 3), () => choice(["", "a\\n", "\\u0041", "\\\\", "\\x41"]) + "${" + choice([operand(), choice(strings)]) + "}").join("") + "`"));
  expressions.push(...times(120, () => `(${choice([...strings, ...others])} ${choice(["===", "!==", "==", "!="])} ${choice([...strings, ...others])})`));

  const mayBeMember = (text: string) => isTypeScript && !["true", "false", "null", "undefined", "==", "!", "<=", ">=", " < ", " > ", "String.raw"].some(word => text.includes(word));
  const lines = [
    "// @ts-nocheck",
    'const one = v => typeof v === "number" ? (Object.is(v, -0) ? "-0" : v !== v ? "NaN" : v.toPrecision(17) + " " + String(v)) : typeof v === "string" ? JSON.stringify(v) : String(v);',
    'const say = (n, ...v) => console.log(n, v.map(one).join(" | "));',
  ];
  if (isTypeScript) lines.push("enum E {", ...expressions.flatMap((text, i) => (mayBeMember(text) ? [`  M${i} = ${text},`] : [])), "}");
  expressions.forEach((e, i) => lines.push(`const c${i} = ${e}; say(${i}, ${e} ?? "s", ${e} || "s", ${e} && "s", \`\${${e}}\`, "" + ${e}, !${e}, ${e} ? 1 : 2, \`\${c${i}}\`, c${i}${mayBeMember(e) ? `, E.M${i}` : ""});`));
  return { file: isTypeScript ? "main.ts" : "main.mjs", text: lines.join("\n") + "\n" };
}
