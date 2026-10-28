// Small TypeScript programs of two to four files in which `import name = holder.member` gives a member of a namespace a name of its own, and the name is then used as a value.
//
//   the holder    `import holder = require("./file")` of a file with exports or with `export =`, `import * as holder`, a `namespace` of the same file or of another file, an enum, a name that was itself bound this way
//   the member    a `const`, a `let` that its file stores to later, a function, a class, an enum, a namespace inside the namespace, a member of that one
//   the name      at the top of a file, inside a `namespace`, exported again by `export import` and read from a third file, used before the line that binds it stands (in a function called later)
//   the use       arithmetic, a template, a call, `new`, `typeof`, a member, a closure, a store through a function of the file that holds it and a second read
import type { Random } from "./random";

type Member = { name: string; declares: string; uses: (name: string) => string[] };

const members = (random: Random, tag: string): Member[] => [
  {
    name: "count",
    declares: `export const count = ${random.pick(["10", "2.5", "-0", "2147483648"])};`,
    uses: n => [`${n} + 1`, `typeof ${n}`, `\`\${${n}}\``, `[${n}][0]`, `(() => ${n})()`],
  },
  {
    name: "word",
    declares: `export const word = ${JSON.stringify(tag)};`,
    uses: n => [`${n} + "!"`, `${n}.length`, `typeof ${n}`, `${n}.toUpperCase()`],
  },
  {
    name: "moving",
    declares: `export let moving = 1;\nexport function move(): number {\n  return ++moving;\n}`,
    uses: n => [`${n}`, `${n} * 2`, `typeof ${n}`],
  },
  {
    name: "double",
    declares: `export function double(given: number): number {\n  return given * 2;\n}`,
    uses: n => [`${n}(4)`, `typeof ${n}`, `${n}.name`, `${n}.length`, `[1, 2].map(${n}).join()`],
  },
  {
    name: "Point",
    declares: `export class Point {\n  static made = 0;\n  constructor(public x: number = 3) {\n    Point.made++;\n  }\n  twice(): number {\n    return this.x * 2;\n  }\n}`,
    uses: n => [
      `new ${n}(5).twice()`,
      `new ${n}().x`,
      `${n}.made`,
      `${n}.name`,
      `typeof ${n}`,
      `new ${n}() instanceof ${n}`,
    ],
  },
  {
    name: "Color",
    declares: `export enum Color {\n  Red,\n  Green = 5,\n  Blue,\n}`,
    uses: n => [`${n}.Green`, `${n}.Blue + 1`, `${n}[5]`, `Object.keys(${n}).length`, `typeof ${n}`],
  },
  {
    name: "Level",
    declares: `export enum Level {\n  Low = "low",\n  High = "high",\n}`,
    uses: n => [`${n}.High`, `${n}.Low + "!"`, `Object.values(${n}).join()`],
  },
  {
    name: "list",
    declares: `export const list = [1, 2.5, ${JSON.stringify(tag)}];`,
    uses: n => [`${n}.length`, `${n}[1]`, `${n}.join()`, `Array.isArray(${n})`],
  },
  {
    name: "record",
    declares: `export const record = { inside: { deep: 7 }, plain: ${JSON.stringify(tag)} };`,
    uses: n => [`${n}.inside.deep`, `${n}.plain`, `Object.keys(${n}).join()`],
  },
];

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  const main: string[] = [];
  const shown: string[] = [];
  const later: string[] = [];
  const holders = random.between(1, 3);
  for (let at = 0; at < holders; at++) {
    const all = members(random, `w${at}`);
    const inner = members(random, `i${at}`).filter(member => member.name !== "moving");
    const body = all.map(member => member.declares).join("\n");
    const innerBody = inner.map(member => member.declares.replace(/^/gm, "  ")).join("\n");
    const withInner = `${body}\nexport namespace inner {\n${innerBody}\n}`;
    const holder = `holder${at}`;
    const kind = random.weighted([
      [4, "require of exports"],
      [2, "require of export equals"],
      [3, "star"],
      [3, "namespace here"],
      [2, "namespace of another file"],
      [1, "default object"],
    ] as const);
    let hasInner = true;
    if (kind === "require of exports") {
      files[`lib${at}.ts`] = withInner + "\n";
      main.push(`import ${holder} = require("./lib${at}");`);
    } else if (kind === "require of export equals") {
      files[`lib${at}.ts`] = `namespace all {\n${withInner.replace(/^/gm, "  ")}\n}\nexport = all;\n`;
      main.push(`import ${holder} = require("./lib${at}");`);
    } else if (kind === "star") {
      files[`lib${at}.ts`] = withInner + "\n";
      main.push(`import * as ${holder} from "./lib${at}";`);
    } else if (kind === "namespace here") {
      main.push(`namespace ${holder} {\n${withInner.replace(/^/gm, "  ")}\n}`);
    } else if (kind === "namespace of another file") {
      files[`lib${at}.ts`] = `export namespace ${holder} {\n${withInner.replace(/^/gm, "  ")}\n}\n`;
      main.push(`import { ${holder} } from "./lib${at}";`);
    } else {
      files[`lib${at}.ts`] = `namespace all {\n${withInner.replace(/^/gm, "  ")}\n}\nexport default all;\n`;
      main.push(`import ${holder} from "./lib${at}";`);
    }
    const names = random.between(1, 4);
    for (let n = 0; n < names; n++) {
      const deep = hasInner && random.chance(0.35);
      const member = random.pick(deep ? inner : all);
      const name = `${member.name}${at}_${n}`;
      const path = deep ? `${holder}.inner` : holder;
      const say = (label: string, expression: string) =>
        `console.log(${JSON.stringify(`${name} ${label}:`)}, ${expression});`;
      const uses = member.uses(name);
      const picked = [random.pick(uses), random.pick(uses)];
      const way = random.weighted([
        [5, "at the top"],
        [2, "through a name bound the same way"],
        [2, "inside a namespace"],
        [2, "exported again"],
        [1, "used above"],
        [1, "a member of the member"],
      ] as const);
      if (way === "at the top") {
        main.push(`import ${name} = ${path}.${member.name};`);
        for (const use of picked) shown.push(say("top", use));
      } else if (way === "through a name bound the same way") {
        main.push(`import via${at}_${n} = ${path};`, `import ${name} = via${at}_${n}.${member.name};`);
        for (const use of picked) shown.push(say("via", use));
      } else if (way === "inside a namespace") {
        main.push(
          `namespace local${at}_${n} {\n  import ${name} = ${path}.${member.name};\n  export const seen = () => [${picked.join(", ")}];\n}`,
        );
        shown.push(`console.log(${JSON.stringify(`${name} local:`)}, ...local${at}_${n}.seen());`);
      } else if (way === "exported again" && kind !== "namespace here") {
        const from =
          kind === "namespace of another file"
            ? `import { ${holder} } from "./lib${at}";`
            : kind === "star"
              ? `import * as ${holder} from "./lib${at}";`
              : kind === "default object"
                ? `import ${holder} from "./lib${at}";`
                : `import ${holder} = require("./lib${at}");`;
        files[`again${at}_${n}.ts`] = `${from}\nexport import ${name} = ${path}.${member.name};\n`;
        main.push(`import { ${name} } from "./again${at}_${n}";`);
        for (const use of picked) shown.push(say("again", use));
      } else if (way === "used above") {
        main.push(
          `function early${at}_${n}() {\n  return [${picked.join(", ")}];\n}`,
          `import ${name} = ${path}.${member.name};`,
        );
        shown.push(`console.log(${JSON.stringify(`${name} early:`)}, ...early${at}_${n}());`);
      } else if (member.name === "Color" || member.name === "Level") {
        const constant = member.name === "Color" ? "Green" : "High";
        main.push(`import ${name} = ${path}.${member.name}.${constant};`);
        shown.push(say("constant", name), say("constant", `typeof ${name}`));
      } else {
        main.push(`import ${name} = ${path}.${member.name};`);
        for (const use of picked) shown.push(say("top", use));
      }
      if (member.name === "moving" && !deep && way === "at the top")
        later.push(`console.log(${JSON.stringify(`${name} moved:`)}, ${holder}.move(), ${name}, ${holder}.moving);`);
    }
  }
  return { file: "main.ts", text: [...main, ...shown, ...later].join("\n") + "\n", files };
}
