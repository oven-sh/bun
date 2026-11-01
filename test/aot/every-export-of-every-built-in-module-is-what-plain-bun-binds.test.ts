// Every export of every built-in module, bound by name and read in a function, at top level, out of a list, a written variable, a Map, an object and a field.
// The modules and their exports are those of the Bun that runs the test, so a new export is asked about from the day it is there.
import { expect } from "bun:test";
import { test } from "./harness/declare";
import { bunEnv, bunExe, tempDir } from "harness";
import { builtinModules } from "node:module";
import { join } from "node:path";

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

function writeReads(module: string, exports: string[], number: number): string {
  const lines = [
    `import { ${exports.map((name, i) => `${name} as e${number}_${i}`).join(", ")} } from ${JSON.stringify(module)};`,
  ];
  exports.forEach((name, i) => {
    const [e, n] = [`e${number}_${i}`, `${number}_${i}`];
    lines.push(
      `function kind${n}() { return typeof ${e}; }`,
      `function name${n}() { return typeof ${e} === "function" ? ${e}?.name : "-"; }`,
      `function length${n}() { if (typeof ${e} === "function") return ${e}.length; return "no function"; }`,
      `const list${n} = [${e}]; let written${n}; written${n} = ${e}; const map${n} = new Map([["k", ${e}]]); const object${n} = { held: ${e} };`,
      `class Holder${n} { held = ${e}; }`,
      `say(${JSON.stringify(module + " " + name)}, kind${n}(), String(name${n}()), length${n}(), typeof ${e}, typeof list${n}[0], typeof written${n}, typeof map${n}.get("k"), typeof object${n}.held, typeof new Holder${n}().held, list${n}[0] === ${e} && map${n}.get("k") === ${e});`,
    );
  });
  return lines.join("\n");
}

const parts = 4;
for (let part = 0; part < parts; part++) {
  test.concurrent(
    `part ${part + 1} of ${parts}`,
    async () => {
      const texts: string[] = [];
      for (const [number, module] of modules.entries()) {
        if (number % parts !== part) continue;
        const exports = await exportsOf(module);
        if (exports.length > 0) texts.push(writeReads(module, exports, number));
      }
      expect(texts.length).toBeGreaterThan(10);
      const imports = texts.flatMap(text => text.split("\n").slice(0, 1));
      const reads = texts.flatMap(text => text.split("\n").slice(1));
      const program = [
        ...imports,
        `const say = (...words) => console.log(words.join(" "));`,
        ...reads,
        `process.exit(0);`,
      ].join("\n");
      using dir = tempDir("every-export", { "main.mjs": program, "package.json": `{ "name": "every-export" }` });
      const run = async (...command: string[]) => {
        await using process = Bun.spawn({
          cmd: command,
          cwd: String(dir),
          env: bunEnv,
          stdout: "pipe",
          stderr: "pipe",
        });
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
    },
    170_000,
  );
}
