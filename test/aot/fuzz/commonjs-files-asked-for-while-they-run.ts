// Small programs in which a CommonJS file is asked for again while it runs, by itself or by what it requires, and then throws or ends.
// The lines are printed as they come: which files run, in which order, and whether each call answers or throws. They leave out which names a namespace holds.
//
//   the entry point   imports the first file or the module, awaits an `import()` of the first file, requires it, or calls `import()` of it
//   the first file    a CommonJS file: requires the module, or calls `import()` of it
//   the module        an ES module: comes to the file by an `import` declaration, by `import()` or by `require()`
//   the file          does up to two of these, and then throws or ends: `import()` of itself, `require()` of itself, `require()` of a CommonJS file or of an ES module that calls
//                     `import()` of it, `require()` of an ES module that imports it, a drain of the jobs
//   a second run      under `bun run` a CommonJS file that threw runs again when it is asked for again (docs/compiler/compatibility.mdx). Here it throws the same error at once
import type { Random } from "./random";

const imports = (from: string, target: string) =>
  `import("./${target}").then(\n  () => console.log("${from}: imported ${target}"),\n  error => console.log("${from}: ${target} is rejected,", error.message),\n);\n`;
const requires = (from: string, target: string) =>
  `try {\n  require("./${target}");\n  console.log("${from}: required ${target}");\n} catch (error) {\n  console.log("${from}: require of ${target} threw,", error.message);\n}\n`;

export function generate(random: Random) {
  const throws = random.chance(0.7);
  const start = random.pick([
    "imports first",
    "imports module",
    "awaits first",
    "requires first",
    "calls first",
  ] as const);
  // Nothing catches what an `import` declaration of the entry point throws.
  const road = random.pick(
    start === "imports module" ? (["call", "require"] as const) : (["declaration", "call", "require"] as const),
  );

  const steps = {
    itself: imports("file", "file.cjs"),
    again: requires("file", "file.cjs"),
    throughFile: `require("./asks.cjs");\n`,
    throughModule: `require("./asks.mjs");\n`,
    cycle: `require("./back.mjs");\n`,
    drain: `require("bun:jsc").drainMicrotasks();\n`,
  };
  const names = Object.keys(steps) as (keyof typeof steps)[];
  const taken = Array.from({ length: random.weighted([[1, 0], [4, 1], [5, 2]] as const) }, () => random.pick(names)); // prettier-ignore

  const text =
    {
      "imports first": `import "./first.cjs";\n`,
      "imports module": `import "./module.mjs";\n`,
      "awaits first": `try {\n  await import("./first.cjs");\n  console.log("main: imported first.cjs");\n} catch (error) {\n  console.log("main: first.cjs is rejected,", error.message);\n}\n`,
      "requires first": requires("main", "first.cjs"),
      "calls first": imports("main", "first.cjs"),
    }[start] + `console.log("main ends");\nexport {};\n`;

  // Each .cjs file names something of CommonJS and each .mjs file exports: how a file is read that has no such sign is another subject.
  const files: Record<string, string> = {
    "first.cjs":
      `module.exports = {};\nconsole.log("first begins");\n` +
      (random.chance(0.65) ? requires("first", "module.mjs") : imports("first", "module.mjs")) +
      `console.log("first ends");\n`,
    "module.mjs":
      {
        declaration: `import "./file.cjs";\n`,
        call: imports("module", "file.cjs"),
        require: requires("module", "file.cjs"),
      }[road] + `console.log("module ends");\nexport {};\n`,
    "file.cjs":
      (throws
        ? `if (globalThis.hasRun) throw new RangeError("thrown by the file");\nglobalThis.hasRun = true;\n`
        : "") +
      `console.log("file begins");\nexports.value = 1;\n` +
      taken.map(name => steps[name]).join("") +
      (throws ? `throw new RangeError("thrown by the file");\n` : `console.log("file ends");\n`),
    "asks.cjs": `module.exports = {};\n` + imports("asks.cjs", "file.cjs") + `console.log("asks.cjs ends");\n`,
    "asks.mjs": imports("asks.mjs", "file.cjs") + `console.log("asks.mjs ends");\nexport {};\n`,
    "back.mjs": `import "./file.cjs";\nconsole.log("back ends");\n`,
  };
  return { file: "main.mjs", text, files };
}
