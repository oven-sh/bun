// Small programs whose first file exports a name and loads another file, and the last file of that road takes the name of the first file again and reads it (`corners`: how the first file loads the next one, and
// how the last one takes the name).
//
//   out        `import`, `require`, `import()` with and without `await`, `import.meta.require`, a function of `createRequire`; ahead of the declaration, behind it or between two stores
//   between    nothing, or a file that goes on by `import`, `import()` or `require`
//   back       `import` by name, the namespace, `import()`, `require`, or an ES module that hands the name on
//   the name   `var`, `let`, `const`, a function, a class, the default, an enum; declared and exported in one or in two statements, under its own name or another; stored once, later, or twice with values of two kinds
//   read       while the file loads, in a job, in a timer, when the first file calls; with and without something that catches
//   the files  JavaScript, TypeScript, or one of each
//
// TypeScript accepts every program. The executable prints what plain Bun prints and ends as it ends.
import type { Random } from "./random";

const outs = ["import", "require", "import()", "await import()", "import.meta.require", "createRequire"] as const;
const backs = ["by name", "the namespace", "import()", "require", "handed on"] as const;
const requires = (how: string) => /require/i.test(how);
// An `import()` of the first file that begins below a `require` is left out: `bun run` never settles it.
export const corners = outs.flatMap(out =>
  backs.filter(back => back !== "import()" || !requires(out)).map(back => `out by ${out}, back by ${back}`),
);

const values = [
  `"a" + process.argv.length`,
  "process.argv.length",
  "process.argv.length / 4",
  "{ a: process.argv.length }",
  "[process.argv.length]",
  "() => process.argv.length",
  `"text"`,
  "7",
  "1.5",
];

export function generate(
  random: Random,
  corner: string,
): { file: string; text: string; files: Record<string, string> } {
  // The relations first.
  const out = outs.find(each => corner.startsWith(`out by ${each},`))!;
  const back = backs.find(each => corner.endsWith(`back by ${each}`))!;
  // Where the first file waits for the next one, that one waits for the last: which of two files that wait for nothing goes on first is not what is asked here.
  const between = random.weighted([
    [3, "nothing"],
    [2, "import"],
    // Two files that wait for each other never end: the first one for the road, the last one, by its `import`, for the first.
    [
      out !== "await import()" ? 3 : back === "import()" || back === "require" ? 3 : 0,
      out === "await import()" ? "await import()" : "import()",
    ],
    [back === "import()" ? 0 : 2, "require"],
  ] as const);
  const language = random.weighted([
    [4, "JavaScript"],
    [3, "TypeScript"],
    [2, "the program in TypeScript"],
    [1, "the others in TypeScript"],
  ] as const);
  const isProgramTyped = language === "TypeScript" || language === "the program in TypeScript";
  const areOthersTyped = language === "TypeScript" || language === "the others in TypeScript";
  const declared = random.weighted([
    [4, "var"],
    [2, "let"],
    [2, "const"],
    [1, "a function"],
    [1, "a class"],
    [2, "the default"],
    [2, "var, exported apart"],
    [1, "let, under another name"],
    [2, "var, stored later"],
    [2, "var, stored twice"],
    [isProgramTyped ? 1 : 0, "an enum"],
    [isProgramTyped ? 2 : 0, "var with a type"],
  ] as const);
  const value = random.pick(values);
  const second = random.pick(values.filter(each => each !== value));
  const where = random.pick(["ahead", "ahead", "behind", "between"] as const);
  const moments = random.sample(
    ["while it loads", "in a job", "in a timer", "when the program calls"] as const,
    random.between(1, 3),
  );
  const catches = random.chance(0.6);
  const asks = random.pick(["the kind", "the kind", "the value", "both"] as const);
  const isKept = random.chance(0.3);

  const name = declared === "the default" ? "default" : "v";
  const kind = value.startsWith('"')
    ? "string"
    : /^[p0-9]/.test(value)
      ? "number"
      : value.startsWith("{")
        ? "{ a: number }"
        : value.startsWith("[")
          ? "number[]"
          : "() => number";
  const [first, later] = {
    "var": [`export var v = ${value};`, ""],
    "let": [`export let v = ${value};`, ""],
    "const": [`export const v = ${value};`, ""],
    "a function": [`export function v() {\n  return ${value};\n}`, ""],
    "a class": [`export class v {\n  static member = ${value};\n}`, ""],
    "the default": [`export default ${value.startsWith("{") ? `(${value})` : value};`, ""],
    "var, exported apart": [`var v = ${value};\nexport { v };`, ""],
    "let, under another name": [`let inner = ${value};\nexport { inner as v };`, ""],
    "var, stored later": [`export var v${isProgramTyped ? ": unknown" : ""};`, `v = ${value};`],
    "var, stored twice": [`export var v${isProgramTyped ? ": unknown" : ""} = ${value};`, `v = ${second};`],
    "an enum": [`export enum v {\n  A = 1,\n  B = "b",\n}`, ""],
    "var with a type": [`export var v: ${kind} = ${value};`, ""],
  }[declared];

  const script = (isTyped: boolean) => (isTyped ? "ts" : "mjs");
  const named = (file: string, isTyped: boolean) => `"./${file}${isTyped ? "" : ".mjs"}"`;
  const main = named("main", isProgramTyped);
  const go = (how: string, to: string) =>
    ({
      "import": `import ${to};`,
      "require": `require(${to});`,
      "import()": `import(${to});`,
      "await import()": `await import(${to});`,
      "import.meta.require": `import.meta.require(${to});`,
      "createRequire": `createRequire(import.meta.url)(${to});`,
    })[how]!;

  const files: Record<string, string> = {};
  const last = between === "nothing" ? "next" : "last";
  if (between !== "nothing")
    files[`next.${script(areOthersTyped)}`] =
      `console.log("the file between");\n${go(between, named("last", areOthersTyped))}\nexport {};\n`;
  if (back === "handed on")
    files[`hands.${script(areOthersTyped)}`] =
      random.chance(0.5) && name !== "default" ? `export * from ${main};\n` : `export { ${name} } from ${main};\n`;

  const any = areOthersTyped ? ": any" : "";
  const read = back === "by name" || back === "handed on" ? "taken" : `entry.${name}`;
  const head = {
    "by name": `import { ${name} as taken } from ${main};\n`,
    "handed on": `import { ${name} as taken } from ${named("hands", areOthersTyped)};\n`,
    "the namespace": `import * as entry from ${main};\n`,
    "import()": "",
    "require": "",
  }[back];
  const shown =
    asks === "the kind" ? `typeof ${read}` : asks === "the value" ? `show(${read})` : `typeof ${read}, show(${read})`;
  const told = isKept
    ? `globalThis.kept = ${asks === "the value" ? `show(${read})` : `typeof ${read}`};\n  console.log(label, globalThis.kept);`
    : `console.log(label, ${shown});`;
  const look =
    `function show(value${any}) {\n  return typeof value === "function" ? "function " + (value.member ?? value()) : JSON.stringify(value);\n}\n` +
    `function look(label${areOthersTyped ? ": string" : ""}${read.startsWith("entry") && back !== "the namespace" ? `, entry${any}` : ""}) {\n` +
    (catches
      ? `  try {\n  ${told.replaceAll("\n", "\n  ")}\n  } catch (error) {\n    console.log(label, "THROWS", error instanceof ReferenceError ? "ReferenceError" : error instanceof TypeError ? "TypeError" : typeof error);\n  }\n`
      : `  ${told}\n`) +
    `}\n`;
  const more = back === "import()" || back === "require" ? ", entry" : "";
  const looks = moments
    .map(
      moment =>
        ({
          "while it loads": `look("while it loads"${more});`,
          "in a job": `queueMicrotask(() => look("in a job"${more}));`,
          "in a timer": `setTimeout(() => look("in a timer"${more}), 1);`,
          "when the program calls": `globalThis.asked = () => look("when the program calls"${more});`,
        })[moment],
    )
    .join("\n");
  files[`${last}.${script(areOthersTyped)}`] =
    head +
    look +
    `console.log("the last file");\n` +
    (back === "import()"
      ? `import(${main}).then(entry => {\n${looks.replace(/^/gm, "  ")}\n});\n`
      : back === "require"
        ? `const entry = require(${main});\n${looks}\n`
        : `${looks}\n`) +
    "export {};\n";

  const leaves = go(out, named("next", areOthersTyped));
  const text =
    (out === "import"
      ? `${leaves}\n`
      : out === "createRequire"
        ? `import { createRequire } from "node:module";\n`
        : "") +
    `console.log("the program starts");\n` +
    (out !== "import" && where === "ahead" ? `${leaves}\n` : "") +
    `${first}\n` +
    (out !== "import" && where === "between" ? `${leaves}\n` : "") +
    (later ? `${later}\n` : "") +
    (out !== "import" && where === "behind" ? `${leaves}\n` : "") +
    `globalThis.asked?.();\nconsole.log("the program ends");\n`;

  if (isProgramTyped || areOthersTyped) {
    files["globals.d.ts"] =
      'declare const require: (name: string) => any;\ndeclare const process: {\n  argv: string[];\n};\ninterface ImportMeta {\n  require(name: string): any;\n  url: string;\n}\ndeclare var asked: undefined | (() => void);\ndeclare var kept: unknown;\ndeclare module "node:module" {\n  export function createRequire(url: string): (name: string) => any;\n}\n';
    files["tsconfig.json"] =
      JSON.stringify(
        {
          compilerOptions: {
            target: "esnext",
            module: "preserve",
            moduleResolution: "bundler",
            noEmit: true,
            strict: true,
            types: [],
            allowJs: true,
          },
        },
        null,
        2,
      ) + "\n";
  }
  return { file: `main.${script(isProgramTyped)}`, text, files };
}
