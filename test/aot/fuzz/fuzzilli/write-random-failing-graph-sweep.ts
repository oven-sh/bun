// Generates random graphs of ES modules, with cycles and some CommonJS leaves, in which modules throw or read what is not initialized yet. The entry loads several modules one after the other, some of them twice, by `import()` or by `require`.
// Each program prints what every load gives: the names and values of the module, or the error. The program number is the random seed.
//
//   bun write-random-failing-graph-sweep.ts <folder> [from] [count] [stride]      writes <folder>/<n>-<files>-files--<loads>-loads--<failing>-fail.mjs
//   bun write-random-failing-graph-sweep.ts count
import { mkdirSync, writeFileSync } from "fs";
import { printThroughBranch } from "./print-through-branch.ts";

const total = 8_000_000;

function createRandom(seed: number) {
  let state = (seed * 2654435761 + 12345) >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let hash = Math.imul(state ^ (state >>> 15), state | 1);
    hash ^= hash + Math.imul(hash ^ (hash >>> 7), hash | 61);
    return ((hash ^ (hash >>> 14)) >>> 0) / 4294967296;
  };
  const below = (end: number) => Math.floor(next() * end);
  return { below, chance: (of: number) => next() < of, pick: <T>(from: readonly T[]): T => from[below(from.length)] };
}

function write(seed: number): { name: string; text: string } {
  const random = createRandom(seed);
  const count = 4 + random.below(5);
  const isCommonJS = Array.from({ length: count }, (_, index) => index > count / 2 && random.chance(0.25));
  const path = (index: number) => `m${index}.${isCommonJS[index] ? "cjs" : "mjs"}`;
  const failing = new Set(Array.from({ length: random.pick([0, 1, 1, 1, 2]) }, () => random.below(count)));
  const files: string[][] = [];
  for (let index = 0; index < count; index++) {
    const lines: string[] = [];
    const name = "x" + index;
    if (isCommonJS[index]) {
      // A CommonJS file requires only CommonJS files behind it.
      const others = isCommonJS.flatMap((is, at) => (is && at > index ? [at] : []));
      if (others.length && random.chance(0.4)) lines.push(`const other = require("./${path(random.pick(others))}");`);
      if (failing.has(index))
        lines.push(
          random.pick([
            `throw new Error("${name} fails");`,
            `if (!globalThis.again${index}) {\n  globalThis.again${index} = true;\n  throw new Error("${name} fails once");\n}`,
          ]),
        );
      lines.push(
        random.pick([
          `exports.${name} = "${name}";`,
          `module.exports = { ${name}: "${name}", other: typeof other };`.replace(
            "typeof other",
            lines[0]?.startsWith("const other") ? "typeof other" : "1",
          ),
          `exports.${name} = () => "${name}";`,
        ]),
      );
      files.push(lines);
      continue;
    }
    // Edges lead to any ES module, so there are cycles, and to CommonJS files.
    const targets = [...new Set(Array.from({ length: random.below(4) }, () => random.below(count)))].filter(
      at => at !== index || random.chance(0.1),
    );
    const reads: string[] = [];
    for (const target of targets) {
      const from = `"./${path(target)}"`;
      const form = random.below(7);
      // A module may import itself, but not a name that it declares.
      switch (target === index && form > 1 ? 1 : form) {
        case 0:
          lines.push(`import ${from};`);
          break;
        case 1:
          lines.push(`import * as n${target} from ${from};`);
          reads.push(
            random.pick([`n${target}.x${target}`, `Object.keys(n${target}).length`, `typeof n${target}.x${target}`]),
          );
          break;
        case 2:
          lines.push(`export { x${target} as from${target} } from ${from};`);
          break;
        case 3:
          lines.push(isCommonJS[target] ? `import ${from};` : `export * from ${from};`);
          break;
        default:
          lines.push(`import { x${target} } from ${from};`);
          reads.push(random.pick([`x${target}`, `typeof x${target}`, `String(x${target})`]));
      }
    }
    // What is read early may not be initialized. A read stands in a try, in a function that is called later, or alone.
    for (const read of reads)
      switch (random.below(5)) {
        case 0:
          lines.push(
            `const early${lines.length} = (() => {\n  try {\n    return typeof ${read};\n  } catch (error) {\n    return error.name;\n  }\n})();`.replace(
              "typeof typeof",
              "typeof",
            ),
            `export const seen${lines.length} = early${lines.length};`,
          );
          break;
        case 1:
          lines.push(`export const taken${lines.length} = ${read};`);
          break;
        default:
          lines.push(`export function later${lines.length}() {\n  return ${read};\n}`);
      }
    if (failing.has(index))
      lines.push(
        random.pick([
          `throw new Error("${name} fails");`,
          `if (globalThis.allowed !== ${index}) throw new TypeError("${name} fails");`,
          `null.${name};`,
          `await Promise.reject(new Error("${name} fails late"));`,
        ]),
      );
    lines.push(
      random.pick([
        `export const ${name} = "${name}";`,
        `export let ${name} = "${name}";`,
        `export function ${name}() {\n  return "${name}";\n}`,
        `export class ${name} {\n  static text = "${name}";\n}`,
        `export const ${name} = [${index}].join();`,
        `const local = "${name}";\nexport { local as ${name} };`,
        `export var ${name} = "${name}";`,
      ]),
    );
    if (random.chance(0.3)) lines.push(`console.log("evaluates ${name}");`);
    files.push(lines);
  }
  const isRequire = random.chance(0.4);
  const loads = Array.from({ length: 3 + random.below(5) }, () => random.below(count));
  if (random.chance(0.5)) loads.push(loads[0]);
  const load = (index: number) =>
    isRequire && random.chance(0.6)
      ? `load(() => require("./${path(index)}"))`
      : `await load(() => import("./${path(index)}"))`;
  const usesRequire = isRequire;
  const describe =
    'const describe = value => typeof value === "string" ? value : typeof value === "function" ? (value.text ?? call(value)) : typeof value;';
  const main = [
    ...(usesRequire
      ? ['import { createRequire } from "node:module";', "const require = createRequire(import.meta.url);"]
      : []),
    "const call = run => {",
    "  try {",
    "    return String(run());",
    "  } catch (error) {",
    "    return error.name;",
    "  }",
    "};",
    describe,
    'const show = module => Object.keys(module).filter(key => key !== "module.exports").sort().map(key => {',
    "  try {",
    '    return key + "=" + describe(module[key]);',
    "  } catch (error) {",
    '    return key + "!" + error.name;',
    "  }",
    '}).join(" ");',
    "const load = run => {",
    "  try {",
    "    const given = run();",
    "    if (given instanceof Promise) return given.then(module => console.log(show(module)), error => console.log(error.name, error.message));",
    "    console.log(show(given));",
    "  } catch (error) {",
    "    console.log(error.name, error.message);",
    "  }",
    "};",
    ...loads.flatMap((index, at) => [
      ...(failing.has(index) && at > 1 && random.chance(0.3) ? [`globalThis.allowed = ${index};`] : []),
      load(index) + ";",
    ]),
  ];
  const text = [
    "// @entry: ./main.mjs",
    ...main,
    ...files.flatMap((lines, index) => [`// @filename: ./${path(index)}`, ...lines]),
  ];
  return { name: `${count}-files--${loads.length}-loads--${failing.size}-fail.mjs`, text: text.join("\n") + "\n" };
}

const padNumber = (index: number) => String(index).padStart(7, "0");
if (process.argv[2] === "count") console.log(total);
else {
  const [folder, from, count, stride] = [process.argv[2], Number(process.argv[3] ?? 0), Number(process.argv[4] ?? total), Number(process.argv[5] ?? 1)]; // prettier-ignore
  mkdirSync(folder, { recursive: true });
  for (let step = 0; step < Math.min(count, total); step++) {
    const index = (from + step * stride) % total;
    const program = write(index);
    writeFileSync(
      `${folder}/${padNumber(index)}-${program.name}`,
      printThroughBranch(program.text, index, program.name),
    );
  }
  console.log(Math.min(count, total));
}
