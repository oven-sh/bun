// Two things that a process remembers by the address or the hash of a text.
//
// Objects with so many names, or with names deleted, that they keep a table of them. The table is nearly empty, half full, full to its limit, full of deleted places, and it grows and shrinks while it is asked.
//   asked      a read, `in`, hasOwn, a store, an addition, a delete; by a written name, by a name made at run time, by a symbol; a name that is there, that never was, that was deleted, that a prototype has
//   where      the object itself, a prototype with a table, two of them in a row, Object.prototype behind them
//   when       in a hot loop over a ring of names, between additions and deletes
//
// Texts whose lower and upper case forms are asked for again and again.
//   the texts  hundreds that last, so that many share a place; some are dropped and made again; written, joined at run time, cut out of a longer one, of one byte and of two bytes a letter, empty, already in that case,
//              with letters that become two, with a final sigma
//   asked      toLowerCase, toUpperCase, both in turn, the locale's forms; of a ring of five to nine texts in a hot loop, of all in a row, behind a collection
import type { Random } from "./random";

const prelude = `function fold(sum: number, value: unknown): number {
  const text = String(value);
  let next = sum;
  for (let i = 0; i < text.length && i < 12; i++) next = (next * 33 + text.charCodeAt(i)) % 1000003;
  return (next + text.length) % 1000003;
}
const glue = (...parts: (string | number)[]): string => parts.join("");`;

function tables(random: Random, index: number): string {
  const n = String(index);
  const size = random.pick([3, 8, 15, 16, 17, 31, 32, 33, 63, 64, 65, 70, 127, 128, 129, 200, 513]);
  const stem = random.pick(["k", "name", "a", "field_", "x$"]);
  const chain = random.weighted([[4, "own"], [2, "prototype"], [1, "two prototypes"], [1, "bare"]] as const); // prettier-ignore
  const lines = [
    `const table${n}: Record<string | symbol, unknown> = ${chain === "bare" ? "Object.create(null)" : "{}"};`,
    `for (let i = 0; i < ${size}; i++) table${n}[glue("${stem}", i)] = i;`,
    random.chance(0.6) ? `for (let i = 0; i < ${size}; i += ${random.pick([2, 3, 5])}) delete table${n}[glue("${stem}", i)];` : `delete table${n}["${stem}0"];`,
    random.chance(0.3) ? `const mark${n} = Symbol("mark");\ntable${n}[mark${n}] = "marked";` : "",
    chain === "prototype" ? `const asked${n}: Record<string | symbol, unknown> = Object.create(table${n});\nasked${n}.own = 1;`
    : chain === "two prototypes" ? `const middle${n}: Record<string, unknown> = Object.create(table${n});\nfor (let i = 0; i < 70; i++) middle${n}[glue("m", i)] = -i;\ndelete middle${n}.m3;\nconst asked${n}: Record<string | symbol, unknown> = Object.create(middle${n});`
    : `const asked${n} = table${n};`,
  ]; // prettier-ignore
  const written = [
    `${stem}1`,
    `${stem}2`,
    `${stem}${size - 1}`,
    `${stem}${size}`,
    `${stem}0`,
    "missing",
    "abcde",
    "toString",
    "constructor",
    "__proto__",
    "own",
    "m3",
    "m4",
    "",
    "0",
    "length",
  ];
  const name = () => JSON.stringify(random.pick(written));
  const acts = [
    () => `sum = fold(sum, asked${n}[${name()}]);`,
    () => `sum = fold(sum, ${name()} in asked${n});`,
    () => `sum = fold(sum, Object.hasOwn(asked${n}, ${name()}));`,
    () => `sum = fold(sum, asked${n}[ring[turn % ring.length]]);`,
    () => `sum = fold(sum, ring[turn % ring.length] in asked${n});`,
    () => `sum = fold(sum, Object.hasOwn(asked${n}, ring[(turn * 7) % ring.length]));`,
    () => `sum = fold(sum, asked${n}[glue("${stem}", turn % ${size + 9})]);`,
    () => `asked${n}[ring[turn % ring.length]] = turn;`,
    () => `if (turn % ${random.pick([7, 50, 333])} === 0) table${n}[glue("late", turn)] = turn;`,
    () => `if (turn % ${random.pick([5, 40, 111])} === 0) delete table${n}[glue("${stem}", turn % ${size})];`,
    () => `if (turn % ${random.pick([9, 60])} === 1) table${n}[glue("${stem}", turn % ${size})] = -turn;`,
    () =>
      `if (turn === ${random.pick([10, 500])}) for (const key of Object.keys(table${n}).slice(4)) delete table${n}[key];`,
    () =>
      `sum = fold(sum, (asked${n} as any).${random.pick([`${stem.replace(/[^a-z_$]/g, "")}1`, "missing", "abcde", "own", "late0"])});`,
  ];
  const ring = random
    .shuffled(written)
    .slice(0, random.between(3, 9))
    .map(one =>
      random.chance(0.5)
        ? JSON.stringify(one)
        : `glue(${JSON.stringify(one.slice(0, 1))}, ${JSON.stringify(one.slice(1))})`,
    );
  lines.push(
    `{\n  const ring: string[] = [${ring.join(", ")}];\n  let sum = 0;\n  for (let turn = 0; turn < ${random.pick([60, 2000, 6000])}; turn++) {\n    ${random
      .shuffled(acts)
      .slice(0, random.between(2, 6))
      .map(act => act())
      .join(
        "\n    ",
      )}\n  }\n  console.log("${n} table", sum, Object.keys(table${n}).length, Object.keys(asked${n}).slice(0, 5).join());\n}`,
  );
  return lines.filter(line => line !== "").join("\n");
}

const odd = [
  `""`,
  `"ß"`,
  `"ǅ"`,
  `"İstanbul"`,
  `"ΑΣ"`,
  `"ΑΣ Σ"`,
  `"ﬁne"`,
  `"ÀÉ"`,
  `"àé"`,
  `"ABC"`,
  `"abc"`,
  `"a1-_"`,
  `"Ω"`,
  `"𐐀𐐨"`,
  `"I"`,
  `"i"`,
  `"ŉ"`,
  `"Content-Type"`,
  `"content-type"`,
];

function conversions(random: Random, index: number): string {
  const n = String(index);
  const many = random.pick([5, 9, 130, 600, 1500]);
  const made = random.weighted([
    [3, `glue(${random.pick([`"Key"`, `"x-Header-"`, `"É"`, `"ß"`, `""`])}, i)`],
    [1, `"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij".slice(i % 20, (i % 20) + 1 + (i % 9)) + i`],
    [1, `String.fromCharCode(65 + (i % 26), 97 + (i % 7), 0x391 + (i % 20)) + i`],
    [1, `(i % 2 ? "Upper" : "lower") + (i >> 1)`],
  ] as const); // prettier-ignore
  const way = () =>
    random.pick(["toLowerCase", "toLowerCase", "toUpperCase", "toUpperCase", "toLocaleLowerCase", "toLocaleUpperCase"]);
  const acts = [
    () => `sum = fold(sum, ring[turn % ring.length].${way()}());`,
    () => `sum = fold(sum, ring[turn % ring.length].${way()}().${way()}());`,
    () => `sum = fold(sum, texts${n}[(turn * 13) % texts${n}.length].${way()}());`,
    () => `sum = fold(sum, ring[turn % ring.length].${way()}() === ring[turn % ring.length]);`,
    () => `if (turn % ${random.pick([64, 500])} === 0) texts${n}[turn % texts${n}.length] = glue("Fresh", turn);`,
    () => `if (turn % ${random.pick([97, 700])} === 0) ring[turn % ring.length] = glue("Ring", turn % 5);`,
    () => `if (turn % ${random.pick([400, 1500])} === 399) Bun.gc(true);`,
    () => `sum = fold(sum, glue("Made", turn % 3).${way()}());`,
    () => `seen[ring[turn % ring.length].${way()}()] = turn;`,
  ];
  return [
    `const texts${n}: string[] = [];`,
    `for (let i = 0; i < ${many}; i++) texts${n}.push(${made});`,
    `{\n  const ring: string[] = [${[...random.shuffled(odd).slice(0, random.between(1, 5)), ...Array.from({ length: random.between(2, 6) }, (_, k) => `texts${n}[${k * 3} % texts${n}.length]`)].join(", ")}];\n  const seen: Record<string, number> = {};\n  let sum = 0;\n  for (const text of texts${n}) sum = fold(sum, text.${way()}());\n  for (let turn = 0; turn < ${random.pick([100, 3000, 8000])}; turn++) {\n    ${random
      .shuffled(acts)
      .slice(0, random.between(2, 5))
      .map(act => act())
      .join(
        "\n    ",
      )}\n  }\n  for (const text of texts${n}) sum = fold(sum, text.${way()}());\n  console.log("${n} texts", sum, ring.map(text => text.toUpperCase() + "|" + text.toLowerCase()).join(), Object.keys(seen).length);\n}`,
  ].join("\n");
}

export function generate(random: Random): string {
  return (
    [
      prelude,
      ...Array.from({ length: random.between(2, 5) }, (_, index) =>
        random.chance(0.5) ? tables(random, index) : conversions(random, index),
      ),
      "export {};",
    ].join("\n") + "\n"
  );
}
