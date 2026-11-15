// `(x & 7) < 8`, `text.length > 2` where text is "a" | "bc": comparisons whose answer a compiler may fold from what it knows of the
// range of each side. Each scene pairs two expressions whose ranges look settled, some of them only at first sight: Math.abs of the
// least int32, a negation that gives -0, a sum past 2 ** 31, a remainder of a negative number, charCodeAt past the end, a length of
// a text that is none of the written ones. The operands arrive at the edges of the integers and as things that are no integers.
import type { Random } from "./random";

/** Expressions of `x` (a number at run time, or not) and `i` (the turn). */
const sides = [
  "x & 7",
  "x & 255",
  "(x & 7) + 8",
  "(x & 255) - 256",
  "x % 5",
  "(x | 0) % 5",
  "x >>> 28",
  "x >>> 0",
  "x | 0",
  "x >> 31",
  "~x",
  "(x | 0) + 1",
  "(x | 0) - 1",
  "-(x | 0)",
  "(x | 0) * 2",
  "(x | 0) * (x | 0)",
  "Math.abs(x | 0)",
  "Math.min(x & 3, 2)",
  "Math.max(x & 3, 2)",
  "Math.min(x, 2)",
  "Math.clz32(x)",
  "Math.sign(x)",
  "Math.floor(x)",
  "Math.imul(x, 2)",
  "text.length",
  "text.length",
  "other.length",
  "list.length",
  "list.length - 1",
  "text.charCodeAt(x & 3)",
  "text.charCodeAt(0)",
  "text.indexOf(WORD)",
  "bytes[0]",
  "bytes[x & 7]",
  "signed[0]",
  "wide[0]",
  "i",
  "i + 1",
  "i - 1",
  "i * 2",
  "i & 1",
  "i % 3",
  "i < 2 ? 1 : 2",
  "i < 2 ? 1 : 2.5",
  "flag ? 3 : 4",
  "+flag",
  "0",
  "1",
  "2",
  "-1",
  "8",
  "256",
  "2147483647",
  "2147483648",
  "-2147483648",
  "4294967295",
  "0.5",
  "NaN",
];

const compares = ["<", "<", "<=", ">", ">", ">=", "===", "!=="];

const values = [
  "i",
  "i",
  "i * 3",
  "-i",
  "i - 1",
  "2147483647",
  "-2147483648",
  "2147483647 - (i & 1)",
  "-2147483648 + (i & 1)",
  "4294967295",
  "1073741824",
  "2 ** 53",
  "0.5",
  "-0.5",
  "-0",
  "NaN",
  "Infinity",
  'CAST(word("12"))',
  "CAST(null)",
  "CAST(undefined)",
  "CAST(true)",
  "i % 5 === 4 ? 0.5 : i",
  "i % 5 === 4 ? -2147483648 : i",
];

const texts = [
  '"a"',
  '"bc"',
  '""',
  '"long text"',
  "i % 2 ? TEXTA : TEXTB",
  'CAST2(word("none of them"))',
  "TEXTA + TEXTB",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const isPlain = random.chance(0.35);
    const pairs = Array.from({ length: random.between(1, 4) }, () => {
      const left = random.pick(sides);
      const right = random.pick(sides);
      const side = (code: string) => (typed ? `(${code} as number)` : `(${code})`);
      return `${side(left)} ${random.pick(compares)} ${side(right)}`;
    });
    const fill = (code: string) =>
      code
        .replace(/CAST2\(((?:[^()]|\([^()]*\))*)\)/g, (_, inner: string) =>
          typed ? `(${inner} as unknown as "a" | "bc")` : inner,
        )
        .replace(/CAST\(((?:[^()]|\([^()]*\))*)\)/g, (_, inner: string) =>
          typed ? `(${inner} as unknown as number)` : inner,
        )
        .replace(/\bTEXTA\b/g, typed ? '("a" as string)' : '"a"')
        .replace(/\bTEXTB\b/g, typed ? '("bc" as string)' : '"bc"')
        .replace(/\bWORD\b/g, typed ? '("c" as string)' : '"c"');
    const value = fill(isPlain ? "i" : random.pick(values));
    const first = fill(random.pick(texts));
    const turns = random.pick([6, 40, 300, 3000]);
    const asked = pairs.map(pair => `(${fill(pair)}) ? "y" : "n"`).join(", ");
    const inLoop = random.chance(0.5);
    const param = (name: string, type: string) => `${name}${as(type)}`;
    const isNarrow = typed && !first.includes("as string") && !first.includes('"long text"') && first !== '""';
    const asking = `const other${as(isNarrow ? '"a" | "bc"' : "string")} = i % 3 ? "a" : "bc";
  const list = i % 2 ? [1, 2] : [1, 2, 3];
  const flag = i % 2 === 0;
  bytes${scene}[0] = x;
  signed${scene}[0] = x;
  wide${scene}[0] = x;
  const bytes = bytes${scene};
  const signed = signed${scene};
  const wide = wide${scene};
  return [${asked}].join("");`;
    scenes.push(`const bytes${scene} = new Uint8Array(8);
const signed${scene} = new Int8Array(1);
const wide${scene} = new Uint32Array(1);
function ask${scene}(${param("x", "number")}, ${param("i", "number")}, ${param("text", "string")}) {
  ${asking}
}
{
  let hash = 0;
  let last = "";
  for (let i = 0; i < ${turns}; i++) {
    ${
      inLoop
        ? `last = ask${scene}(${value}, i, ${first});`
        : `const x${as("number")} = ${value};
    const text${as("string")} = ${first};
    last = ask${scene}(x, i, text);`
    }
    for (let at = 0; at < last.length; at++) hash = (hash * 31 + last.charCodeAt(at)) | 0;
  }
  console.log("scene ${scene}", hash, last);
}`);
  }
  return `const word${as("(text: string) => string")} = Function("text", "return text")${
    typed ? " as (text: string) => string" : ""
  };
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
