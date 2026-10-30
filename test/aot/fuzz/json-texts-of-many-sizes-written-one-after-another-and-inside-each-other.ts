// Small programs that call `JSON.stringify` a few times in a row on values of very different sizes, from ten characters to more than a million, with something in between or in the middle: a collection, a
// text that is given up half way because something throws, a `toJSON`, a getter or a replacer that itself calls `JSON.stringify`, a character late in the text that needs sixteen bits. Each text is
// what it would be alone. Of each text the length and a sum over its characters are printed, at once, by `console.log` itself.
//
//   the values   a list of small objects, an object with many short members, a list of numbers, of texts, one long text, lists in lists
//   the sizes    ten, a few thousand, seventy thousand, three hundred thousand, more than a million characters; rising, falling, the same twice
//   in between   nothing, `Bun.gc(true)`, many short-lived objects, a job
//   in the middle  a member that holds the whole, a BigInt, a `toJSON` or a getter that throws at one element; one that writes another text, small or large; a replacer that does
//   the text     plain letters, quotes and line breaks, a character outside Latin-1 first, last or nowhere, a lone half of a pair; with an indentation or without
import type { Random } from "./random";

export function generate(random: Random): { file: string; text: string } {
  const size = () => random.pick(["3", "3", "200", "3000", "12000", "50000"]);
  const odd = () =>
    random.pick(['""', '""', '""', '"\\u2028"', '"\\u00e9"', '"\\ud83d\\ude00"', '"\\ud800"', '"\\"\\n"']);
  const shapes: [number, (n: string, late: string) => string][] = [
    [
      5,
      (n, late) =>
        `Array.from({ length: ${n} }, (unused, index) => ({ id: index, name: "n" + index + (index === ${n} - 1 ? ${late} : "") }))`,
    ],
    [
      4,
      (n, late) =>
        `Object.fromEntries(Array.from({ length: ${n} }, (unused, index) => ["k" + index, index === ${n} - 1 ? ${late} : index]))`,
    ],
    [2, n => `Array.from({ length: ${n} }, (unused, index) => index * 1.5)`],
    [2, (n, late) => `Array.from({ length: ${n} }, (unused, index) => "text " + index + (index === 0 ? ${late} : ""))`],
    [2, (n, late) => `"abcdefghij".repeat(${n}) + ${late}`],
    [1, n => `Array.from({ length: ${n} }, (unused, index) => [index, [index, [index]]])`],
    [
      1,
      (n, late) =>
        `{ head: ${late}, list: Array.from({ length: ${n} }, (unused, index) => ({ a: index, b: true, c: null })) }`,
    ],
  ];
  const value = () => random.weighted(shapes)(size(), odd());
  const more = () => random.pick(["", "", "", ", null, 1", ', null, "\\t"', ', ["id", "name", "a"]']);
  const plain = () => `tell(JSON.stringify(${value()}${more()}));`;

  const inside = () => {
    const inner = random.pick([
      `JSON.stringify(${value()})`,
      `JSON.stringify(${value()})`,
      "JSON.stringify({ small: 1 })",
      "JSON.stringify([this.id])",
    ]);
    const at = random.pick(["0", "1", "150", "2999"]);
    return random.pick([
      `tell(\nJSON.stringify(\nArray.from({ length: ${size()} }, (unused, index) => ({\nid: index,\ntoJSON() {\nreturn index === ${at} ? ${inner}.length : this.id;\n},\n})),\n),\n);`,
      `tell(\nJSON.stringify(\nArray.from({ length: ${size()} }, (unused, index) => ({\nid: index,\nget more() {\nreturn index === ${at} ? ${inner}.length : 0;\n},\n})),\n),\n);`,
      `tell(JSON.stringify(${value()}, function (key, held) {\nreturn key === "${at}" ? ${inner.replace("this.id", "key")}.length : held;\n}));`,
    ]);
  };
  const givenUp = () => {
    const at = random.pick(["0", "2", "150", "2999", "11999"]);
    const n = random.pick(["200", "3000", "12000", "50000"]);
    const bad = random.pick([
      `index === ${at} ? 1n : index`,
      `index === ${at} ? {\ntoJSON() {\nthrow new RangeError("no");\n},\n} : index`,
      `index === ${at} ? {\nget x() {\nthrow new RangeError("no");\n},\n} : index`,
      `index === ${at} ? whole : index`,
    ]);
    return `try {\nconst whole = [];\nfor (let index = 0; index < ${n}; index++) whole.push(${bad});\ntell(JSON.stringify(whole));\n} catch (error) {\nconsole.log("given up", error.constructor.name);\n}`;
  };
  const between = () =>
    random.pick([
      "",
      "",
      "Bun.gc(true);",
      "Bun.gc(true);",
      'for (let i = 0; i < 20000; i++) junk = { a: i, b: "j" + i };',
      "await null;",
    ]);

  const steps: string[] = [];
  const count = random.between(2, 5);
  for (let i = 0; i < count; i++) {
    steps.push(
      random.weighted([
        [6, plain],
        [3, inside],
        [3, givenUp],
      ])(),
    );
    const rest = between();
    if (rest) steps.push(rest);
  }
  const body = steps.join("\n");
  const head = [
    "function tell(text) {\nlet sum = 0;\nfor (let i = 0; i < text.length; i++) sum = (sum * 31 + text.charCodeAt(i)) | 0;\nconsole.log(text.length, sum, text.slice(0, 20), text.slice(-12));\n}",
    body.includes("junk") ? "let junk;" : "",
  ]
    .filter(Boolean)
    .join("\n");
  const waits = body.includes("await null");
  const guarded = `try {\n${body}\n} catch (error) {\nconsole.log("THROWS", error.constructor.name);\n}`;
  if (waits || random.chance(0.5)) return { file: "main.mjs", text: `${head}\n${guarded}\n` };
  return { file: "main.cjs", text: `${head}\nfunction run() {\n${guarded}\n}\nrun();\n` };
}
