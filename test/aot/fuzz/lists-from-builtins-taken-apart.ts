// A built-in answers with a fresh list: split, match, exec, entries, keys, slice, from. The program takes it apart at once, by
// a pattern or by index, and often nothing else sees the list, so the compiler need not make it. Each scene picks the
// built-in and its operands, written out or made at run time, and how the list is taken apart: more places than it has
// elements, defaults, a rest, holes in the pattern, its length, members such as index and groups. In some iterations the list
// is also kept, changed before it is read, handed to a function nobody knows, or compared with itself.
import type { Random } from "./random";

/** Expressions for a fresh list. TEXT is a string, written out or not. */
const lists = [
  'TEXT.split("=")',
  'TEXT.split("=")',
  'TEXT.split("=", 2)',
  'TEXT.split("=", 1)',
  'TEXT.split("=", 0)',
  'TEXT.split("")',
  "TEXT.split()",
  'TEXT.split("none")',
  "TEXT.split(/=/)",
  "TEXT.split(/(=)/)",
  "TEXT.split(separator)",
  "TEXT.match(/(\\w)=(\\w)?/)",
  "TEXT.match(/\\w/g)",
  "/(?<left>\\w+)=(?<right>\\w*)/.exec(TEXT)",
  "[...TEXT]",
  "Array.from(TEXT)",
  "Object.entries({ a: TEXT, b: i })[0]",
  "Object.entries({ a: TEXT, b: i })",
  "Object.keys({ [TEXT]: 1, b: 2 })",
  "Object.values({ a: TEXT, b: i })",
  "[TEXT, i, TEXT].slice(1)",
  "[TEXT].concat([i])",
  "[TEXT, i].map(each => each)",
  "[TEXT, i].filter(each => each !== i)",
  "Array.of(TEXT, i)",
  'TEXT.split("=").reverse()',
  "[...TEXT.matchAll(/\\w/g)][0]",
];

const refusedByTypeScript = ["TEXT.split()", "[TEXT].concat([i])", "Array.of(TEXT, i)"];

const texts = [
  '"k=v"',
  '"k=v"',
  '"k=v=w"',
  '"kv"',
  '""',
  '"="',
  '"k="',
  'word("k=v")',
  'word("k=v=w")',
  '("k" + i % 3 + "=v")',
  '"\\u{1F600}=v"',
  '(i % 2 ? "k=v" : "kv")',
];

/** Statements that take `list` apart and add to `line`. */
const uses = [
  'const [a, b] = list;\n      line += a + "," + b;',
  'const [a, b] = list;\n      line += a + "," + b;',
  'const [a, b, c] = list;\n      line += a + "," + b + "," + c;',
  'const [a = "none", b = "none", c = "none"] = list;\n      line += a + "," + b + "," + c;',
  'const [a, ...rest] = list;\n      line += a + "," + rest.length + "," + rest[0];',
  "const [, b] = list;\n      line += b;",
  'const [[a] = [], b] = list;\n      line += a + "," + b;',
  'line += list[0] + "," + list[1];',
  'line += list[0] + "," + list[5] + "," + list[-1];',
  "line += list.length;",
  'line += list.length + "," + list[list.length - 1];',
  'line += list.index + "," + list.input + "," + list.groups?.left;',
  'line += (1 in list) + "," + (2 in list);',
  'const { 0: a, 1: b, length } = list;\n      line += a + "," + b + "," + length;',
  'for (const each of list) line += each + ";";',
  'line += list.join("|");',
  'line += Array.isArray(list) + "," + typeof list;',
  "line += list.at(-1);",
];

/** Statements that stand between the making and the taking apart. */
const between = [
  "",
  "",
  "",
  "if (isRare) kept.push(list);",
  'if (isRare) list[0] = "stored";',
  'if (isRare) list.push("pushed");',
  "if (isRare) list.length = 1;",
  "if (isRare) list.extra = 1;",
  "if (isRare) unknown(list);",
  "if (isRare) delete list[0];",
  "if (isRare) Object.freeze(list);",
  "if (isRare) line += list === list;",
  "list[1] = i;",
  "if (isRare) list.reverse();",
  "if (isRare) line += JSON.stringify(list);",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const when = random.pick(["i === 1", "i === turns - 1", "i % 97 === 5", "false", "false"]);
    const made = random
      .pick(typed ? lists.filter(list => !refusedByTypeScript.includes(list)) : lists)
      .replaceAll("TEXT", random.pick(texts));
    scenes.push(`function scene${scene}(turns${as("number")}, separator${as("string")})${as("string")} {
  const answers = new Set${typed ? "<string>" : ""}();
  for (let i = 0; i < turns; i++) {
    const isRare = ${when};
    let line = "";
    try {
      const list${as("any")} = ${made};
      ${random.pick(between)}
      ${random
        .sample(uses, random.between(1, 2))
        .map(use => `{\n      ${use}\n      }`)
        .join("\n      ")}
    } catch (error) {
      line += "threw " + ${typed ? "(error as Error)" : "error"}.name;
    }
    // The iteration's number is taken out, so that the usual iterations give one answer.
    answers.add(line.replaceAll(String(i), "i"));
  }
  return [...answers].slice(0, 6).join(" | ");
}
console.log("scene ${scene}", scene${scene}(${random.pick([1, 3, 300, 3000])}, ${random.pick(['"="', '"v"', '""', '"=v"'])}), "kept", JSON.stringify(kept.splice(0)));`);
  }
  return `const kept${as("unknown[]")} = [];
const word = (text${as("string")})${as("string")} => process.argv[9] ?? text;
const ways${as("((list: any) => unknown)[]")} = [list => list.pop(), list => (list[0] = "by a table"), () => 0];
let calls = 0;
const unknown = (list${as("any")}) => ways[calls++ % ways.length](list);
${scenes.join("\n")}
${typed ? "export {};\n" : ""}`;
}
