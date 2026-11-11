// Every export of every built-in module, bound by name and read out of a list. Of three exports the table of built-ins said only that they let in code nobody has seen: read so, each was
// undefined, and elsewhere the program ended by a signal. parallel/library-modules/exports-that-let-in-unseen-code-bound-by-name.mjs holds those three in every place a binding is read.
// The modules and their exports are those of the Bun that runs the test, so a new export is asked about from the day it is there.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { test } from "../supported";

// `bun:test` answers outside a test run with functions that throw. The others start something when they are loaded, or print a warning.
const leftOut = new Set([
  "bun:test",
  "bun:main",
  "bun:wrap",
  "bun:internal-for-testing",
  "node:test",
  "node:repl",
  "node:cluster",
]);
const named = [
  ...builtinModules.map(name => (name.includes(":") ? name : "node:" + name)),
  "bun:ffi",
  "bun:jsc",
  "bun:sqlite",
  "undici",
  "ws",
];
const modules = [...new Set(named)].filter(name => !leftOut.has(name)).sort();

async function exportsOf(module: string): Promise<string[]> {
  try {
    return Object.keys(await import(module)).filter(name => /^[A-Za-z_$][\w$]*$/.test(name) && name !== "default");
  } catch {
    return [];
  }
}

test("each is what plain Bun binds", async () => {
  const [imports, reads]: string[][] = [[], []];
  for (const [number, module] of modules.entries()) {
    const exports = await exportsOf(module);
    if (exports.length === 0) continue;
    imports.push(
      `import { ${exports.map((name, i) => `${name} as e${number}_${i}`).join(", ")} } from ${JSON.stringify(module)};`,
    );
    exports.forEach((name, i) => {
      const [e, list] = [`e${number}_${i}`, `list${number}_${i}`];
      reads.push(
        `const ${list} = [${e}]; say(${JSON.stringify(module + " " + name)}, typeof ${e}, typeof ${list}[0], ${list}[0] === ${e});`,
      );
    });
  }
  expect(imports.length).toBeGreaterThan(60);
  expect(reads.length).toBeGreaterThan(1200);
  using dir = tempDir("every-export", {
    "main.mjs": [
      ...imports,
      `const say = (...words) => console.log(words.join(" "));`,
      ...reads,
      `process.exit(0);`,
    ].join("\n"),
    "package.json": `{ "name": "every-export" }`,
  });
  const run = async (...command: string[]) => {
    await using process = Bun.spawn({ cmd: command, cwd: String(dir), env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([
      process.stdout.text(),
      process.stderr.text(),
      process.exited,
    ]);
    return { stdout, stderr, exitCode };
  };
  const plain = await run(bunExe(), "main.mjs");
  expect(plain.exitCode).toBe(0);
  const build = await run(bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "app");
  expect(build.stderr + build.stdout).not.toContain("error:");
  expect(build.exitCode).toBe(0);
  const compiled = await run(join(String(dir), "app"));
  expect(compiled.stdout.split("\n")).toEqual(plain.stdout.split("\n"));
  expect(compiled.exitCode).toBe(0);
}, 170_000);
