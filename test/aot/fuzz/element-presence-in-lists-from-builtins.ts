// A built-in makes a list whose length is only known at run time, and the same function asks whether the list has an
// element: with `in`, Reflect.has, hasOwn, for-in, Object.keys, forEach, or a read. Nothing else keeps the list, so the
// compiler may never build it. The key is a constant inside, at or past the length, and the answer is printed.
import type { Random } from "./random";

/** Expressions for a fresh list of about `count` elements of the list FROM. */
const makers = [
  "FROM.slice().splice(0, count)",
  "FROM.slice(0, count)",
  "FROM.slice(count)",
  "FROM.slice(0, count).concat([])",
  "[].concat(FROM.slice(0, count))",
  "FROM.filter((_, index) => index < count)",
  "FROM.slice(0, count).map(item => item)",
  "[FROM.slice(0, count)].flat()",
  "FROM.flatMap((item, index) => (index < count ? [item] : []))",
  "FROM.toSpliced(count)",
  "FROM.toSorted().slice(0, count)",
  "FROM.toReversed().slice(count)",
  'FROM.with(0, "w").slice(0, count)',
  "Array.from(FROM.slice(0, count))",
  "Array.from({ length: count }, (_, index) => FROM[index])",
  "Array.of(...FROM.slice(0, count))",
  "[...FROM.slice(0, count)]",
  "Array.prototype.slice.call(FROM, 0, count)",
  "new Array(count)",
  "new Array(count).fill(0)",
  "Object.keys(FROM.slice(0, count))",
  "Object.values(FROM.slice(0, count))",
  "Object.entries(FROM.slice(0, count))",
  'text.split(",", count)',
  'text.slice(0, count * 2).split(",")',
  '/(a)?(z)?(b)?/.exec(count ? "ab" : "z")',
  '"abc".match(count ? /(a)(x)?/ : /(b)/)',
  "JSON.parse(JSON.stringify(FROM.slice(0, count)))",
  "structuredClone(FROM.slice(0, count))",
];

/** Function bodies that ask `list` about the key KEY. Those that name `list` once can also take the call in its place. */
const questions = [
  "return KEY in list;",
  'return "KEY" in list;',
  "return Reflect.has(list, KEY);",
  "return Object.hasOwn(list, KEY);",
  "return list.hasOwnProperty(KEY);",
  "return list.propertyIsEnumerable(KEY);",
  "return Object.getOwnPropertyDescriptor(list, KEY) === undefined;",
  'let keys = "";\nfor (const key in list) keys += key;\nreturn keys;',
  'return Object.keys(list).join("");',
  'if (KEY in list) return "in " + list[KEY];\nreturn "out " + list[KEY];',
  'return list[KEY] + " " + (KEY in list);',
  'return (KEY in list) + " " + list[KEY];',
  'return KEY in list ? list[KEY] : "none";',
  'return !(KEY in list) ? "none" : list[KEY];',
  'let seen = "";\nlist.forEach((_, index) => {\n  seen += index;\n});\nreturn seen;',
  'return list.indexOf(undefined) + " " + list.includes(undefined);',
  "return list.findIndex(item => item === undefined);",
  'return list.length + " " + list.join("");',
  "return list[KEY];",
  "return list.at(KEY);",
  "return KEY < list.length;",
  'return (KEY in list) + " " + (OTHER in list);',
  "let found = 0;\nfor (let key = 0; key < 8; key++) if (key in list) found++;\nreturn found;",
  'return has(list, KEY) + " " + (KEY in list);',
];

const sources = ["letters", "numbers", "fractions", "sparse", "mixed"];

/** How the scene's function is called with several counts. ASK is the call with `count`. */
const callers = [
  "for (let count = 0; count < 4; count++) answers.push(ASK);",
  "for (const count of [0, 1, 2, 3, 6, 7]) answers.push(ASK);",
  "for (let count = 7; count >= 0; count -= 2) answers.push(ASK);",
  "for (let round = 0; round < 300; round++) {\n  const count = round % 4;\n  if (round > 295) answers.push(ASK);\n  else ASK;\n}",
  "{\n  const count = process.argv.length > 99 ? 9 : 1;\n  answers.push(ASK);\n}",
];

export function generate(random: Random): string {
  const scenes: string[] = [];
  for (let scene = 0, total = random.between(4, 10); scene < total; scene++) {
    const key = random.pick([0, 1, 1, 2, 3, 5, 6, 7]);
    const maker = random.pick(makers).replaceAll("FROM", random.pick(sources));
    const question = random
      .pick(questions)
      .replaceAll("KEY", String(key))
      .replaceAll("OTHER", String(random.pick([0, 2, 6])));
    const isNamedOnce = question.split(/\blist\b/).length === 2;
    const body =
      isNamedOnce && random.chance(0.5)
        ? question.replace(/\blist\b/, `(${maker})`)
        : `${random.pick(["const", "let"])} list = ${maker};\n${question}`;
    const caller = random.pick(callers);
    // Either a function holds the call and the question, or they stand in the loop itself.
    const isInline = body.startsWith("return ") && !body.includes("\n") && random.chance(0.4);
    scenes.push(
      isInline
        ? `{\nconst answers = [];\n${caller.replaceAll("ASK", body.slice("return ".length, -1))}\nconsole.log("scene ${scene}", answers.join(" | "));\n}`
        : `function scene${scene}(count) {\n${body}\n}\n{\nconst answers = [];\n${caller.replaceAll("ASK", `scene${scene}(count)`)}\nconsole.log("scene ${scene}", answers.join(" | "));\n}`,
    );
  }
  return `const letters = ["a", "b", "c", "d", "e", "f"];
const numbers = [1, 2, 3, 4, 5, 6];
const fractions = [0.5, 1.5, 2.5, 3.5, 4.5, 5.5];
const sparse = ["a", , "c", , "e", "f"];
const mixed = [1, "b", null, undefined, 4.5, { f: 6 }];
const text = "a,b,c,d,e,f";
const has = (list, key) => key in list;
${scenes.join("\n")}
`;
}
