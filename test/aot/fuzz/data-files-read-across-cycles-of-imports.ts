// Small programs of five to thirteen files. ES modules import one another, with cycles among them, and some of them import data files. Every module exports a function that reads what
// the module takes from its data files and calls the functions of the modules that it imports, and the body of every module calls its own function: a data file is read ahead of its turn.
//
//   the data files   JSON, JSON with comments, TOML, YAML, and a text, whose name has a dead zone
//   taken as         the default, members of the default, names, the namespace object listed and read under a computed key
//   the graph        every module is reached from the first; more imports lead anywhere, also back; some modules export the function of another module again
//   started by       an import, two imports beside an `import()` of a name that nobody sets, `import()`, `require`
import type { Random } from "./random";

const kinds: [string, (value: number) => string][] = [
  ["json", value => `{ "a": ${value}, "list": [${value}, ${value + 1}], "in": { "b": "${value}" } }\n`],
  ["jsonc", value => `// ${value}\n{ "a": ${value}, "list": [${value}, ${value + 1}], "in": { "b": "${value}" } }\n`],
  ["toml", value => `a = ${value}\nlist = [${value}, ${value + 1}]\n[in]\nb = "${value}"\n`],
  ["yaml", value => `a: ${value}\nlist: [${value}, ${value + 1}]\nin:\n  b: "${value}"\n`],
  ["txt", value => `text ${value}`],
];

export function generate(random: Random): { file: string; text: string; files: Record<string, string> } {
  const files: Record<string, string> = {};
  const modules = random.between(3, 8);
  const data = Array.from({ length: random.between(1, 4) }, (_, index) => {
    const [extension, write] = random.chance(0.5) ? kinds[0] : random.pick(kinds);
    files[`d${index}.${extension}`] = write(index * 10);
    return { file: `d${index}.${extension}`, isText: extension === "txt" };
  });

  const imports: number[][] = Array.from({ length: modules }, () => []);
  for (let module = 1; module < modules; module++) imports[random.below(module)].push(module);
  for (let more = random.between(1, modules); more > 0; more--) {
    const [from, to] = [random.below(modules), random.below(modules)];
    if (from !== to && !imports[from].includes(to)) imports[from].push(to);
  }

  for (let module = 0; module < modules; module++) {
    const lines: string[] = [];
    const reads: string[] = [];
    const taken = data.flatMap((_, index) => (random.chance(0.35) ? [index] : []));
    for (const [isModule, index] of random.shuffled([
      ...imports[module].map(index => [true, index] as const),
      ...taken.map(index => [false, index] as const),
    ])) {
      if (isModule) {
        lines.push(`import { f as f${index} } from "./m${index}.mjs";`);
        if (random.chance(0.2)) lines.push(`export { f as passed${index} } from "./m${index}.mjs";`);
        continue;
      }
      const { file, isText } = data[index];
      const form = isText ? "default" : random.pick(["default", "default", "members", "names", "namespace"]);
      if (form === "default") {
        lines.push(`import d${index} from "./${file}";`);
        reads.push(`() => JSON.stringify(d${index})`);
      } else if (form === "members") {
        lines.push(`import d${index} from "./${file}";`);
        reads.push(`() => d${index}.in.b + d${index}.list.length`);
      } else if (form === "names") {
        lines.push(`import { a as d${index}, list as l${index} } from "./${file}";`);
        reads.push(`() => d${index} + ":" + l${index}.join("+")`);
      } else {
        lines.push(`import * as d${index} from "./${file}";`);
        reads.push(`() => Object.keys(d${index}).join("+") + d${index}[key] + d${index}.default.a`);
      }
    }
    files[`m${module}.mjs`] = [
      ...lines,
      `${random.pick(["const", "var"])} key = "a";`,
      `function attempt(read) {\n  try {\n    return read();\n  } catch (error) {\n    return error.constructor.name;\n  }\n}`,
      `export function f(depth) {`,
      `  const out = [${reads.map(read => `attempt(${read})`).join(", ")}];`,
      `  if (depth > 0) for (const next of [${imports[module].map(index => `f${index}`).join(", ")}]) out.push(next(depth - 1));`,
      `  return "m${module}(" + out.join() + ")";`,
      `}`,
      `console.log("m${module}:", f(${random.between(1, 3)}));`,
      ``,
    ].join("\n");
  }

  const first = random.chance(0.3) ? random.below(modules) : 0;
  const [file, text] = random.weighted<[string, string]>([
    [2, ["main.mjs", `import "./m${first}.mjs";\n`]],
    [1, ["main.mjs", `await import("./m${first}.mjs");\n`]],
    [1, ["main.cjs", `require("./m${first}.mjs");\n`]],
    [
      1,
      [
        "main.mjs",
        `import "./m${random.below(modules)}.mjs";\nimport "./m${first}.mjs";\nif (process.env.NAME_THAT_NOBODY_SETS) await import(process.env.NAME_THAT_NOBODY_SETS);\n`,
      ],
    ],
  ]);
  return { file, text: text + `console.log("main");\n`, files };
}
