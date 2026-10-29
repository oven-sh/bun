// Functions that end in a call to one another and hand their arguments on. A program has 2 to 5 functions. Each takes a counter and then a
// rest parameter, two values, one value and a rest parameter, or a list. They are declared by name and listed in a table, or written as
// methods inside the table. Each ends by calling another one with the counter one lower: by name, through the table, through a value picked at run time, or with call, apply and Reflect.apply. What it hands on is its own rest array
// spread out, some of its elements, a copy, or the array itself. On the way an array is now and then changed, kept in a global list, or
// captured by a closure that runs at the end. Most calls stand in tail position, so a chain of a million calls has to end without a
// RangeError; short chains also have calls that are not in tail position. The program prints what arrives at the end of each chain, a
// digest of what every call saw, and everything that was kept.
import type { Random } from "./random";

type Shape = "rest" | "two" | "one and rest" | "list";

export function generate(random: Random, typed: boolean): string {
  const as = (type: string) => (typed ? `: ${type}` : "");
  const count = random.between(2, 5);
  const depth = random.pick([3, 10, 200, 5000, 100000, 1000000, 1000000]);
  // In half of the programs an array is only indexed, measured and spread: it is never handed to anything as a whole.
  const gentle = random.chance(0.5);
  // Most of those have no call but the last one in a function.
  const looks = !gentle || random.chance(0.25);
  const shapes: Shape[] = Array.from({ length: count }, () =>
    random.weighted<Shape>([
      [5, "rest"],
      [2, "two"],
      [gentle ? 0 : 2, "one and rest"],
      [gentle ? 0 : 2, "list"],
    ]),
  );
  if (!shapes.includes("rest")) shapes[0] = "rest";
  const positional = shapes.flatMap((shape, index) => (shape === "rest" ? [index] : []));
  // In half of the programs the functions are methods written inside the table, and every call goes through it.
  const methods = random.chance(0.5);
  const f = (index: number) => (methods ? `table.f${index}` : `f${index}`);
  const out: string[] = [`"use strict";`];
  if (typed) out.push(`type Value = number | string;`);
  out.push(
    `let seen = 0;`,
    `const kept${as("Value[][]")} = [];`,
    `const later${as("(() => string)[]")} = [];`,
    `function look(length${as("number")}, first${as("Value")}) {`,
    `  seen = (Math.imul(seen, 31) + length * 7 + String(first).length) | 0;`,
    `}`,
  );

  const parameters: Record<Shape, string> = {
    "rest": `...rest${as("Value[]")}`,
    "two": `a${as("Value")}, b${as("Value")}`,
    "one and rest": `first${as("Value")}, ...rest${as("Value[]")}`,
    "list": `list${as("Value[]")}`,
  };
  // How a function names all its values as one array.
  const mine: Record<Shape, string> = {
    "rest": "rest",
    "two": "[a, b]",
    "one and rest": "[first, ...rest]",
    "list": "list",
  };

  // The arguments for a callee of some shape, out of the array `all`.
  const handOn = (to: Shape, all: string) => {
    const shorter = `(${all}.length < 5 ? [...${all}, n % 7] : ${all}.slice(2))`;
    if (to === "list")
      return random.pick([
        all,
        all,
        `${all}.slice()`,
        `[...${all}]`,
        shorter,
        `${all}.slice(1).concat(${all}.slice(0, 1))`,
      ]);
    if (to === "two")
      return random.pick([
        `${all}[0], ${all}[1]`,
        `${all}[1], ${all}[0]`,
        `${all}[0], n % 5`,
        `${all}[${all}.length - 1], ${all}[0]`,
      ]);
    if (to === "one and rest")
      return random.pick([
        `${all}[0], ...${all}.slice(1)`,
        `n % 3, ...${all}.slice(0, 3)`,
        `${all}[1], ${all}[0]`,
        `${all}[0], ...${all}.slice(0, 4)`,
      ]);
    if (gentle)
      return random.pick([
        `...${all}`,
        `...${all}`,
        `${all}[0], ${all}[1]`,
        `${all}[1], ${all}[0], ${all}[2]`,
        `${all}[0]`,
      ]);
    return random.pick([
      `...${all}`,
      `...${all}`,
      `${all}[0], ${all}[1]`,
      `${all}[1], ${all}[0], ${all}[2]`,
      `...${shorter}`,
      `...${all}.slice(0, 4)`,
    ]);
  };
  const call = (from: number) => {
    const all = shapes[from] === "two" || shapes[from] === "one and rest" ? "all" : mine[shapes[from]];
    const to = random.below(count);
    const args = `n - 1, ${handOn(shapes[to], all)}`;
    return random.weighted<string>([
      [5, `${f(to)}(${args})`],
      [2, `table.f${to}(${args})`],
      [2, `table[names[${to}]](${args})`],
      [2, `picked[(n + ${random.below(3)}) % picked.length](n - 1, ${handOn("rest", all)})`],
      [1, `${f(to)}.call(undefined, ${args})`],
      [1, `${f(to)}.apply(undefined, [${args}])`],
      [1, `Reflect.apply(${f(to)}, undefined, [${args}])`],
    ]);
  };

  if (methods) out.push(`const table = {`);
  for (let index = 0; index < count; index++) {
    const shape = shapes[index];
    const named = shape === "two" || shape === "one and rest";
    const all = named ? "all" : mine[shape];
    out.push(`${methods ? "" : "function "}f${index}(n${as("number")}, ${parameters[shape]})${as("string")} {`);
    if (named) out.push(`  const all${as("Value[]")} = ${mine[shape]};`);
    if (looks) out.push(`  look(${all}.length, ${all}[0]);`);
    out.push(
      `  if (n <= 0) return "f${index} " + ${all}.length + ":" + ${gentle ? `${all}[0] + "," + ${all}[1]` : `${all}.join()`};`,
    );
    for (let extra = random.below(4); extra > 0; extra--) {
      const when = `n === ${random.pick([1, 2, Math.max(1, depth >> 1), Math.max(1, depth - 1)])}`;
      out.push(
        "  " +
          random.pick(
            gentle
              ? [
                  `if (${when}) ${all}[0] = "changed";`,
                  `if (${when}) ${all}[1] = n % 9;`,
                  `if (n === -1) return String(${all}[0]) + n + "0";`,
                  `if (n === -2) return String(${all}[1]) + n + "1";`,
                ]
              : [
                  `if (${when}) kept.push(${all});`,
                  `if (${when}) later.push(() => ${all}.join());`,
                  `if (${when}) ${all}[0] = "changed";`,
                  `if (${when}) ${all}.push(n % 9);`,
                  `if (${when}) ${all}.length = 1;`,
                  `if (n % ${random.pick([64, 1000])} === 0 && kept.length < 8) kept.push(${all});`,
                  `if (${all}.length > 6) ${all}.length = 2;`,
                ],
          ),
      );
    }
    const tail = random.weighted<string>([
      [5, `return ${call(index)};`],
      [3, `return n % ${random.between(2, 4)} === 0 ? ${call(index)} : ${call(index)};`],
      [looks ? 1 : 0, `return (look(${all}.length, ${all}[0]), ${call(index)});`],
      [1, `return n % 2 === 0 || n < 0 ? ${call(index)} : ${call(index)};`],
      [1, `if (n % 5 === 0) return ${call(index)};\n  return ${call(index)};`],
      [depth <= 200 ? 2 : 0, `const result = ${call(index)};\n  return result + ${all}.length;`],
      [
        depth <= 200 ? 1 : 0,
        `try {\n    return ${call(index)};\n  } finally {\n    look(${all}.length, ${all}[0]);\n  }`,
      ],
      [depth <= 200 ? 1 : 0, `return ${call(index)} + "|" + ${all}[0];`],
    ]);
    out.push("  " + tail, methods ? `},` : `}`);
  }
  out.push(
    methods ? `};` : `const table = { ${shapes.map((_, index) => `f${index}`).join(", ")} };`,
    `const names = [${shapes.map((_, index) => `"f${index}"`).join(", ")}]${typed ? " as const" : ""};`,
    `const picked = [${positional.map(f).join(", ")}];`,
  );

  const values = () =>
    Array.from({ length: random.between(0, 5) }, () => random.pick([`1`, `2.5`, `"a"`, `"bc"`, `-7`, `0`]));
  for (let start = random.between(1, 3); start > 0; start--) {
    const index = random.below(count);
    const given = values();
    while (given.length < 2) given.push(`"z"`);
    const args =
      shapes[index] === "list"
        ? `[${given.join(", ")}]`
        : shapes[index] === "two"
          ? given.slice(0, 2).join(", ")
          : given.join(", ");
    // One chain in three starts inside a loop at the top of the module.
    out.push(
      random.chance(0.33) ? `for (let turn = 0; turn < 3; turn++) try {` : `try {`,
      `  console.log(${random.chance(0.5) ? f(index) : `table[names[${index}]]`}(${depth}, ${args}));`,
      `} catch (error) {`,
      `  console.log("throws", (error${typed ? " as Error" : ""}).name);`,
      `}`,
    );
  }
  out.push(
    `console.log("seen", seen);`,
    `for (const list of kept) console.log("kept", list.length, list.join());`,
    `for (const each of later) console.log("later", each());`,
  );
  return out.join("\n") + "\n";
}
