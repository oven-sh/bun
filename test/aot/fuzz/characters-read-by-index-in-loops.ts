// `s[i] === t[j]` and `out += s[i] + n` in a loop whose head compares the position with a length. Where the position is
// proven to lie inside the text the read is a string of one unit, and a compiler may compare code units or append a range
// without making that string. Each scene is one small function with such a loop. The neighbors of the plain case are
// positions that only seem to be inside: one past the end, below zero, a fraction, compared with the length of another text,
// moved between the comparison and the read, or the variable holds another text by then. The texts are stored with one or
// two bytes a character, hold halves of pairs, are joined or cut at run time, and some arguments are no strings at all.
import type { Random } from "./random";

/** Heads of loops over `s`, with `i` as the position. */
const heads = [
  "for (let i = 0; i < s.length; i++)",
  "for (let i = 0; i < s.length; i++)",
  "for (let i = 0; i < s.length; i++)",
  "for (let i = s.length - 1; i >= 0; i--)",
  "for (let i = 0; i + 1 < s.length; i += 2)",
  "for (let i = 0; i <= s.length; i++)",
  "for (let i = -2; i < s.length; i++)",
  "for (let i = 0; i < t.length; i++)",
  "for (let i = 0; i < s.length && i < t.length; i++)",
  "for (let i = 0; i < s.length && i < t.length; i++)",
  "for (let i = 0, n = s.length; i < n; i++)",
  "for (let i = 0.5; i < s.length; i++)",
  "for (let i = 0; i < Math.min(s.length, 9); i++)",
  "for (let i = 1; i < s.length; i *= 2)",
];

/** Statements of the body. */
const bodies = [
  "if (s[i] === t[i]) count++;",
  "if (s[i] === t[i]) count++;",
  "if (s[i] === t[j]) count++;\n    j = (j + 1) % (t.length || 1);",
  "if (s[i] !== t[i]) count++;",
  "if (s[i] == t[i]) count++;",
  "out += s[i]BANG + i;",
  "out += s[i]BANG + i;",
  'out += s[i]BANG + ".";',
  "out = out + (s[i]BANG + count);",
  "if (s[i] === s[s.length - 1 - i]) count++;",
  "if (i > 0 && s[i] === s[i - 1]) count++;",
  "if (s[i] === s[i + 1]) count++;",
  "out += s[i + 1]BANG + s[i]BANG;",
  "list.push(s[i]BANG + i);",
  'if (s[i] === "a") count++;',
  "if (s[i] === first) count++;",
  "if (s[i]BANG < t[i]BANG) count++;",
  "out += typeof s[i];",
  "for (let k = 0; k < t.length; k++) if (s[i] === t[k]) count++;",
  "{\n      const moved = i + (count & 1);\n      out += s[moved]BANG + moved;\n      count++;\n    }",
  "if (i === 2) s = t;\n    out += s[i]BANG + i;",
  "if (i === 2) s += t;\n    if (s[i] === t[i]) count++;",
  "out += s.charAt(i) + i;\n    if (s[i] === t.charAt(i)) count++;",
  "if (s[i] === t[i]) out += s[i]BANG + t[i]BANG;",
];

const texts = [
  '"abcabc"',
  '"abcabc"',
  '"aabbbc"',
  '""',
  '"a"',
  '"caf\\u00e9 cr\\u00e8me"',
  '"\\u4e16\\u754c abc"',
  '"a\\ud83d\\ude00b\\ud83d\\ude00"',
  '"\\ud83d"',
  'word("abc") + word("abc")',
  'word("xxabcabcxx").slice(2, 8)',
  '("\\u2014" + word("abcabc")).slice(1)',
  'JSON.parse(\'["\\u2014","abcabc"]\')[1]',
  'word("ab").repeat(3)',
  'word("abcabc").split("").join("")',
  '"a text of more than sixteen characters, abc"',
  "String(123123)",
];

const strangers = [
  '["a", "b", "c"]',
  "123",
  "null",
  "undefined",
  '{ length: 3, 0: "a", 1: "b", 2: "c" }',
  'new String("abcabc")',
  "Uint8Array.of(1, 2, 3)",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const isPlain = random.chance(0.45);
    const head = random.pick(isPlain ? heads.slice(0, 3) : heads);
    const body = random
      .sample(isPlain ? bodies.slice(0, 9) : bodies, random.pick([1, 1, 2]))
      .join("\n    ")
      .replaceAll("BANG", typed ? "!" : "");
    const pairs = Array.from({ length: random.between(3, 6) }, () => `[${random.pick(texts)}, ${random.pick(texts)}]`);
    if (!isPlain && random.chance(0.4))
      pairs.push(
        `[${random.pick(strangers)}, ${random.pick(texts)}]`,
        `[${random.pick(texts)}, ${random.pick(strangers)}]`,
      );
    scenes.push(`function walk${scene}(s${as("string")}, t${as("string")})${as("string")} {
  let out = "";
  let count = 0;
  let j = 0;
  const first = t[0];
  const list${as("string[]")} = [];
  ${head} {
    ${body}
  }
  return JSON.stringify([out, count, list.join("|"), s.length]);
}
for (const [s, t] of [${pairs.join(", ")}]${typed ? " as [any, any][]" : ""}) {
  let said = "";
  try {
    for (let round = 0; round < ${random.pick([1, 1, 40])}; round++) said = walk${scene}(s, t);
  } catch (error) {
    said = ${typed ? "(error as Error)" : "error"}.name;
  }
  console.log("scene ${scene}", said);
}`);
  }
  return `const word${as("(text: string) => string")} = Function("text", "return text")${typed ? " as (text: string) => string" : ""};
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
