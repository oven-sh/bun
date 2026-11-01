// The same string literal is split again and again, with the same separator. The answer may be remembered from the second time
// on, but each call still hands out a list of its own: what the program does to one answer must not show in the next. Each
// scene sends a few literals through a variable, a parameter, a table or a field to split(), changes the answer in one of
// many ways, splits again and prints both. Separators are strings, patterns, missing or made at run time, with and without a
// limit; some subjects are not literals, or are literals that are also keys.
import type { Random } from "./random";

const subjects = [
  '"a,b,c"',
  '"a,b,c"',
  '"host: example.com"',
  '"k=v"',
  '""',
  '","',
  '"abc"',
  '"a,,b"',
  '"\\u00e9,\\u4f60,x"',
  '"a b  c"',
  '"one"',
  '"x".repeat(3)',
  'word("a,b,c")',
  '"a," + word("b,c")',
  '"key,name"',
  "String(12.5)",
  "`a,${1},c`",
];

const separators = [
  '","',
  '","',
  '": "',
  '"="',
  '""',
  '" "',
  "/,/",
  "/\\s+/",
  "/(,)/",
  "undefined",
  'word(",")',
  '"none"',
  "/,/g",
  '",", 2',
  '",", 0',
  "/,/, 1",
];

/** How the subject gets to the call. SUBJECT is the expression above. */
const paths = [
  "const subject = SUBJECT;",
  "const subject = SUBJECT;",
  'const subject = [SUBJECT, "other"][turn & 0];',
  "const subject = { held: SUBJECT }.held;",
  "const subject = same(SUBJECT);",
  "const subject = table[turn % table.length];",
  "const subject = turn % 2 ? SUBJECT : SUBJECT;",
];

/** Statements that change `first`, the answer of the first split. */
const changes = [
  "",
  "",
  'first[0] = "stored";',
  'first.push("pushed");',
  "first.pop();",
  "first.length = 0;",
  "first.reverse();",
  "first.sort();",
  "first.shift();",
  'first.unshift("front");',
  "first.splice(0, 1);",
  'first.fill("filled");',
  "delete first[0];",
  'first[5] = "far";',
  "first.extra = 1;",
  "Object.freeze(first);",
  "first[0] = 5;",
  "first[0] = 0.5;",
  "first[0] = { n: 1 };",
  "kept.push(first);",
  'Object.defineProperty(first, 0, { get: () => "getter" });',
  "Object.setPrototypeOf(first, null);",
  "first.copyWithin(0, 1);",
];

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(3, 6); scene < total; scene++) {
    const subject = random.pick(subjects);
    const separator = random.pick(separators);
    scenes.push(`function cut${scene}(subject${as("string")})${as("any")} {
  return subject.split(${typed ? separator.replace(/^undefined$/, "undefined as any") : separator});
}
function scene${scene}()${as("string")} {
  const table = [${subject}, ${random.pick(subjects)}];
  const answers = new Set${typed ? "<string>" : ""}();
  for (let turn = 0; turn < ${random.pick([1, 2, 3, 5, 60, 400])}; turn++) {
    let line = "";
    try {
      ${random.pick(paths).replaceAll("SUBJECT", subject)}
      const first = cut${scene}(subject);
      line += shown(first);
      ${random.pick(changes)}
      const second = ${random.pick([`cut${scene}(subject)`, `cut${scene}(subject)`, `cut${scene}(${subject})`, `subject.split(${typed ? separator.replace(/^undefined$/, "undefined as any") : separator})`])};
      line += " | " + shown(second) + " | " + (first === second) + " | " + shown(first);
      ${random.pick(["", "", 'second[0] = "second stored";', "second.length = 1;"])}
    } catch (error) {
      line += " threw " + ${typed ? "(error as Error)" : "error"}.name;
    }
    answers.add(line);
  }
  return [...answers].slice(0, 4).join(" / ");
}
console.log("scene ${scene}", scene${scene}(), "| kept", kept.splice(0, 400).slice(-2).map(shown).join(";"));`);
  }
  return `const kept${as("unknown[]")} = [];
const word = (text${as("string")})${as("string")} => process.argv[9] ?? text;
const same = (text${as("string")})${as("string")} => text;
const keys = { "a,b,c": 1, "k=v": 2, abc: 3 };
function shown(list${as("any")})${as("string")} {
  let text = "";
  for (let at = 0; at < Math.min(list.length, 7); at++) text += (at in list ? typeof list[at] + ":" + String(list[at]?.n ?? list[at]) : "hole") + ",";
  return list.length + "[" + text + "]";
}
${scenes.join("\n")}
console.log(Object.keys(keys).length);
${typed ? "export {};\n" : ""}`;
}
