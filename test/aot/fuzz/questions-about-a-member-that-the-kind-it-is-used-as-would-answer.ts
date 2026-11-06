// Small programs about objects out of `JSON.parse` whose members the program uses as one kind: as numbers, as texts, as objects of one shape, as lists. At run time one member is of another kind, is
// missing, or the members come in another order, and the program asks a question about that member whose answer would be the same for every value of the usual kind, and does nothing else with it.
// The question is answered for the value that is there. Parsing, use and question stand in one loop body. There is one scene, and every line is printed at once, by `console.log` itself.
//
//   the source    `JSON.parse` of a line in a loop over lines, of one text that holds them all, `structuredClone`, `Object.values`, a `Map` filled from parsed text
//   used as       numbers in sums, products and comparisons; whole numbers in indexes and `|`; texts by `length`, `+` and methods; objects by two members; lists by `length` and an element
//   the odd one   a text, an empty text, `null`, an object, a list, a truth value, a fraction, a large number, a number where texts are usual; a member that is not there; members in another
//                 order or one more member; in every line or in one
//   the question  `===` and `!==` with a text, `null`, `true`, `undefined`, a number; `typeof` in every form and in a `switch`; `Array.isArray`; `Number.isInteger`; `instanceof`; `x !== x`;
//                 `Object.is`; in a test, a sum, a condition, a count
//   beside it     the other members are used as usual, ahead of the question or behind it
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const usual = random.weighted([
    [6, "numbers"],
    [2, "whole numbers"],
    [3, "texts"],
    [3, "objects"],
    [2, "lists"],
  ] as const);
  const ordinary = {
    numbers: ["1", "2.5", "3", "0.5", "7"],
    "whole numbers": ["1", "2", "3", "0", "7"],
    texts: ['"a"', '"bc"', '"d"'],
    objects: ['{"n":1,"m":2}', '{"n":3,"m":4}'],
    lists: ["[1,2]", "[3]", "[4,5,6]"],
  }[usual];
  const odd = random.pick(
    {
      numbers: ['"p"', '"p"', '""', "null", '{"n":1}', "[1]", "true", "false", '"1"'],
      "whole numbers": ['"p"', "1.5", "null", "4294967296", "true", "-0", "[2]", "1e21"],
      texts: ["1", "null", "0", '["a"]', '{"length":1}', "true", "1.5"],
      objects: ["null", "1", '"p"', "[1,2]", '{"m":2,"n":1}', '{"n":"t","m":2}', '{"n":1}', "true"],
      lists: ["null", '"ab"', '{"length":2,"0":1}', "1", "[]", '[["x"]]', "true"],
    }[usual],
  );
  const width = random.pick([3, 3, 4]);
  const at = random.below(width);
  const rows = random.pick([3, 4, 6]);
  const oddRows = random.pick(["every", "every", "one", "last"] as const);
  const shape = random.pick(["same", "same", "same", "missing", "turned", "wider"] as const);
  const lines = Array.from({ length: rows }, (_, row) => {
    const isOdd = oddRows === "every" || (oddRows === "one" && row === 1) || (oddRows === "last" && row === rows - 1);
    let members = Array.from(
      { length: width },
      (_, column) => `"k${column}":${column === at && isOdd ? odd : random.pick(ordinary)}`,
    );
    if (isOdd && shape === "missing") members = members.filter((_, column) => column !== at);
    if (isOdd && shape === "turned") members.reverse();
    if (isOdd && shape === "wider") members.unshift('"extra":0');
    return `{${members.join(",")}}`;
  });
  const other = (at + 1) % width;
  const third = (at + 2) % width;
  const X = `c.k${at}`;

  const uses = (e: string) =>
    random.pick(
      {
        numbers: [
          `if (${e} > 1) sum += ${e} * 0.5;`,
          `sum += ${e} * 2;`,
          `sum += ${e} - 1;`,
          `if (${e} < 3) sum += 1;`,
          `sum += Math.floor(${e});`,
        ],
        "whole numbers": [
          `sum += [10, 20, 30, 40][${e} & 3];`,
          `sum += ${e} | 0;`,
          `sum += ${e} << 1;`,
          `for (let i = 0; i < ${e} && i < 3; i++) sum++;`,
        ],
        texts: [`sum += ${e}.length;`, `text += ${e};`, `text += ${e}.toUpperCase();`, `if (${e} < "c") sum++;`],
        objects: [`sum += ${e}.n + ${e}.m;`, `sum += ${e}.n;`, `if (${e}.m > 1) sum += ${e}.n;`],
        lists: [`sum += ${e}.length;`, `sum += ${e}[0];`, `for (const each of ${e}) sum += each;`],
      }[usual],
    );
  const questions = [
    `${X} === "p"`,
    `${X} === "p"`,
    `${X} !== "p"`,
    `${X} === null`,
    `${X} !== null`,
    `${X} === true`,
    `${X} === undefined`,
    `${X} === 1`,
    `${X} === ""`,
    `typeof ${X} === "string"`,
    `typeof ${X} === "string"`,
    `typeof ${X} === "number"`,
    `typeof ${X} !== "number"`,
    `typeof ${X} === "object"`,
    `typeof ${X} === "boolean"`,
    `"string" === typeof ${X}`,
    `Array.isArray(${X})`,
    `Array.isArray(${X})`,
    `Number.isInteger(${X})`,
    `Number.isFinite(${X})`,
    `${X} instanceof Object`,
    `${X} instanceof Array`,
    `${X} !== ${X}`,
    `Object.is(${X}, -0)`,
    `Object.is(${X}, null)`,
    `${X} == null`,
    `!${X}`,
    `!!${X}`,
    `${X} === c.k${other}`,
    `typeof ${X} === typeof c.k${other}`,
  ];
  const Q = random.pick(questions);
  const asked = random.weighted([
    [5, `if (${Q}) hits++;`],
    [2, `hits += ${Q} ? 1 : 0;`],
    [2, `if (${Q}) {\nhits++;\ncontinue;\n}`],
    [2, `if (!(${Q})) misses++;`],
    [1, `${Q} && hits++;`],
    [1, `answers.push(${Q});`],
    [
      2,
      `switch (typeof ${X}) {\ncase "string":\nhits++;\nbreak;\ncase "number":\nmisses++;\nbreak;\ncase "object":\nhits += 10;\nbreak;\ndefault:\nhits += 100;\n}`,
    ],
    [
      1,
      `const kind = typeof ${X};\nif (kind !== "${usual === "texts" ? "string" : usual === "objects" || usual === "lists" ? "object" : "number"}") hits++;`,
    ],
  ]);
  const beside = [uses(`c.k${other}`), random.chance(0.6) ? uses(`c.k${third}`) : ""].filter(Boolean);
  const first = random.chance(0.5);
  const inner = (first ? [asked, ...beside] : [...beside, asked]).join("\n");

  const source = random.weighted([
    [7, ["const lines = LINES;", "for (const line of lines) {\nconst c = JSON.parse(line);\nBODY\n}"]],
    [2, ["const lines = LINES;", "for (let i = 0; i < lines.length; i++) {\nconst c = JSON.parse(lines[i]);\nBODY\n}"]],
    [2, ["const whole = WHOLE;", "for (const c of JSON.parse(whole)) {\nBODY\n}"]],
    [
      1,
      [
        "const whole = WHOLE;",
        "const all = JSON.parse(whole);\nfor (let i = 0; i < all.length; i++) {\nconst c = all[i];\nBODY\n}",
      ],
    ],
    [1, ["const whole = WHOLE;", "for (const c of structuredClone(JSON.parse(whole))) {\nBODY\n}"]],
    [1, ["const whole = WHOLE;", "for (const c of Object.values(JSON.parse(whole))) {\nBODY\n}"]],
    [
      1,
      [
        "const whole = WHOLE;",
        "const table = new Map(JSON.parse(whole).map((each, index) => [index, each]));\nfor (const c of table.values()) {\nBODY\n}",
      ],
    ],
    [1, ["const lines = LINES;", "lines.forEach(line => {\nconst c = JSON.parse(line);\nBODY\n});"]],
  ] as [number, [string, string]][]);
  const isACallback = source[1].includes("forEach");
  const body = isACallback ? inner.replace(/\bcontinue;/g, "return;") : inner;
  const declared = source[0]
    .replace("LINES", () => `[\n${lines.map(line => `'${line}'`).join(",\n")},\n]`)
    .replace("WHOLE", () => `'[${lines.join(",")}]'`);
  const loop = source[1].replace("BODY", () => body);
  const scene = [
    declared,
    "let sum = 0;",
    'let text = "";',
    "let hits = 0;",
    "let misses = 0;",
    "const answers = [];",
    `try {\n${loop}\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`,
    "console.log(String(sum), text, hits, misses, answers.join());",
  ].join("\n");
  const file = random.chance(0.5) ? "main.mjs" : "main.cjs";
  const where = random.pick(["top", "top", "top", "once", "thrice"] as const);
  if (where === "top") return { file, text: `${scene}\n` };
  return { file, text: `function run() {\n${scene}\n}\n${where === "once" ? "run();" : "run();\nrun();\nrun();"}\n` };
}
