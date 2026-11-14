// A string grows step by step, by `+=` in a loop or in a row of statements, and the compiler may gather the pieces in one
// buffer and make the string once at the end. That only works while no earlier state is still needed. In each scene one is:
// it was copied to another variable, kept in a list, captured by a closure, measured, compared, or read in a catch block.
// Other scenes put an object into a template or a key: it is asked for its string at that moment, once, in the order of the
// text, and what it would answer later does not matter.
import type { Random } from "./random";

/** Bodies of `function NAME(n, stop, it)`. */
const bodies = [
  'let text = "";\n  for (let i = 0; i < n; i++) {\n    const before = text;\n    text += PIECE;\n    if (i === stop) kept.push(before);\n  }\n  return text;',
  'let text = "a";\n  const first = text;\n  text += "b";\n  const second = text;\n  text += piece(n);\n  return [first, second, text].join();',
  'let text = "";\n  for (let i = 0; i < n; i++) {\n    text += i;\n    if (text.length > 3) kept.push(text);\n  }\n  return text;',
  'let a = "";\n  let b = "";\n  for (let i = 0; i < n; i++) {\n    a += i;\n    b = a;\n    a += "-";\n  }\n  return a + "|" + b;',
  'let text = "";\n  for (let i = 0; i < n; i++) text = text + i + text.length;\n  return text;',
  'let text = "";\n  for (let i = 0; i < n; i++) {\n    text += PIECE;\n    kept.push(text.length, text.charCodeAt(text.length - 1));\n  }\n  return text;',
  'let text = "";\n  try {\n    for (let i = 0; i < n; i++) {\n      text += i;\n      if (i === stop) throw new Error("stopped");\n      text += ",";\n    }\n  } catch {\n    kept.push(text);\n  }\n  return text;',
  'let text = "";\n  for (let i = 0; i < n; i++) text = PIECE + text;\n  return text;',
  'let text = "ab";\n  for (let i = 0; i < Math.min(n, 4); i++) text += text;\n  return text.length + text.slice(-3);',
  'let text = "";\n  for (let i = 0; i < n; i++) {\n    text += i;\n    if (i === stop) readers.push(() => text);\n  }\n  return text;',
  'let text = "";\n  for (let i = 0; i < n; i++) {\n    const now = (text += i);\n    if (i === stop) readers.push(() => now);\n  }\n  return text;',
  'let text = "";\n  for (let i = 0; i < n; i++) {\n    if (text === "012") kept.push("seen at " + i);\n    text += i;\n  }\n  return text;',
  'let text = "";\n  for (let i = 0; i < n; i++) {\n    text += i;\n    table[text] = i;\n  }\n  return Object.keys(table).join();',
  'let text = "";\n  for (let i = 0; i < n; i++) {\n    text += i % 2 ? PIECE : i;\n    if (i === stop) text = text.toUpperCase();\n  }\n  return text;',
  'let text = "";\n  let other = "x";\n  for (let i = 0; i < n; i++) {\n    [text, other] = [other + i, text];\n  }\n  return text + "|" + other;',
  'const parts LIST = [];\n  let text = "";\n  for (let i = 0; i < n; i++) {\n    text += PIECE;\n    parts.push(text);\n  }\n  return parts.join("/");',
  // An object is asked for its string where the template or the sum stands.
  'const made = `${it}`;\n  it.word = "changed";\n  return made + "," + `${it}`;',
  'const made = `k${it}`;\n  it.word = "changed";\n  table[made] = 1;\n  return Object.keys(table).join();',
  'const made = "k" + it;\n  it.word = "changed";\n  return made + "," + ("k" + it);',
  "return `${it}${it}`;",
  "return `${it}-${bump(it)}-${it}`;",
  "return it + `${bump(it)}` + it;",
  'table[`${it}`] = 1;\n  it.word = "changed";\n  table[`${it}`] = 2;\n  return Object.keys(table).join();',
  'const made = `${it}`;\n  it.word = "changed";\n  return String(made in { first: 1 }) + (made === "first");',
  'let text = "";\n  for (let i = 0; i < Math.min(n, 3); i++) {\n    text += it;\n    it.word += i;\n  }\n  return text;',
  "const list = [`${it}`, bump(it), `${it}`];\n  return list.join();",
  "return String(it) + String(it).length + `${it}`.length;",
  'return [it].join() + [it, it].join("+");',
];

/** Expressions for `it`. */
const things = [
  '{ word: "first", toString() {\n      asked.push("s");\n      return this.word;\n    } }',
  '{ word: "first", toString() {\n      asked.push("s");\n      return this.word;\n    }, valueOf() {\n      asked.push("v");\n      return 7;\n    } }',
  '{ word: "first", [Symbol.toPrimitive](hint HINT) {\n      asked.push(hint);\n      return this.word;\n    } }',
  '{ word: "first", toString() {\n      this.word += "!";\n      return this.word;\n    } }',
  '{ word: "first", toString() {\n      throw new RangeError("no string");\n    } }',
  '{ word: "first" }',
  '["first", 2]',
  "-0",
  "1.5",
  "null",
  "undefined",
  "10n",
  'Symbol("s")',
  '"first"',
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 7); scene < total; scene++) {
    const rounds = random.pick([1, 1, 3, 300, 2000]);
    // The pieces are proven strings in some scenes: only then may the compiler gather them in a buffer.
    const body = random
      .pick(bodies)
      .replaceAll("PIECE", random.pick(["piece(i)", "words[i & 3]", "words[i & 3]", '"x"', "String(i)"]))
      .replaceAll(" LIST", as("string[]"));
    scenes.push(`function scene${scene}(n${as("number")}, stop${as("number")}, it${as("any")})${as("string")} {
  ${body}
}
{
  let last = "";
  for (let round = 0; round < ${rounds}; round++) {
    kept.length = readers.length = asked.length = 0;
    table = {};
    last = [${random
      .sample(["0", "1", "3", "5", "12", "50"], 2)
      .map(
        n =>
          `told(() => scene${scene}(${n}, ${random.pick(["0", "1", "2", "4", "-1"])}, ${random.pick(things).replace(" HINT", as("string"))}))`,
      )
      .join(", ")}].join(" | ");
    last = noted(last + " kept " + kept.join(";") + " readers " + readers.map(reader => reader()).join(";") + " asked " + asked.join(""));
  }
  console.log("scene ${scene}", last, counted());
}`);
  }
  return `// Every round should answer alike: how many different answers there were, and how long they are together.
const rounds = new Set${typed ? "<string>" : ""}();
function noted(answer${as("string")})${as("string")} {
  rounds.add(answer);
  return answer;
}
function counted()${as("string")} {
  const said = rounds.size + ":" + [...rounds].join("").length;
  rounds.clear();
  return said;
}
const kept${as("(string | number)[]")} = [];
const readers${as("(() => string)[]")} = [];
const asked${as("string[]")} = [];
let table${as("Record<string, number>")} = {};
const words${as("string[]")} = ["a", "bc", "", "\\u00e9", "def", "\\u2713"];
const piece = (at${as("number")})${as("string")} => process.argv[9] ?? words[at % words.length];
function bump(it${as("any")})${as("string")} {
  if (it !== null && typeof it === "object") it.word = "bumped";
  return "b";
}
function told(ask${as("() => string")})${as("string")} {
  try {
    return ask();
  } catch (error) {
    return "threw " + ${typed ? "(error as Error)" : "error"}.name;
  }
}
${scenes.join("\n")}
`;
}
