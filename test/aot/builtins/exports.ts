// Every export of every built-in module, bound by name and read in a function, at top level, out of a list, a written variable, a Map, an object and a field.
// And in TypeScript, in a function with a declared result: a wrong proof shows in other places there, because checked code carries no expected type along.
// The modules and their exports are those of the Bun that runs the test, so a new export is asked about from the day it is there.
// Each part has a test file of its own and each of its two programs a case: four parts at once, two builds each, took all of a case's time limit on the lane with sanitizers.
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

// `any`, so that no declaration of an export decides what may be asked of it.
function writeTypedReads(module: string, exports: string[], number: number): string {
  const lines = [
    `import { ${exports.map((name, i) => `${name} as e${number}_${i}`).join(", ")} } from ${JSON.stringify(module)};`,
  ];
  exports.forEach((name, i) => {
    const [e, n] = [`(e${number}_${i} as any)`, `${number}_${i}`];
    lines.push(
      `function name${n}(): unknown { return ${e}?.name; }`,
      `function text${n}(): string | undefined { return typeof ${e} === "function" ? ${e}?.name : undefined; }`,
      `function length${n}(): number | string { if (typeof ${e} === "function") return ${e}.length; return "no function"; }`,
      `class Holder${n} { held = typeof ${e} === "function" ? ${e}.name : undefined; }`,
      `say(${JSON.stringify(module + " " + name)}, typeof name${n}(), String(text${n}()), length${n}(), String(new Holder${n}().held));`,
    );
  });
  return lines.join("\n");
}

function joinTexts(texts: string[], say: string): string {
  const imports = texts.flatMap(text => text.split("\n").slice(0, 1));
  const reads = texts.flatMap(text => text.split("\n").slice(1));
  return [...imports, say, ...reads, `process.exit(0);`].join("\n");
}

export const parts = 4;

export function testPart(number: number) {
  const part = number - 1;
  const written = (async () => {
    const [texts, typedTexts]: string[][] = [[], []];
    for (const [number, module] of modules.entries()) {
      if (number % parts !== part) continue;
      const exports = await exportsOf(module);
      if (exports.length === 0) continue;
      texts.push(writeReads(module, exports, number));
      typedTexts.push(writeTypedReads(module, exports, number));
    }
    return {
      modules: texts.length,
      "main.mjs": joinTexts(texts, `const say = (...words) => console.log(words.join(" "));`),
      "typed.ts": joinTexts(typedTexts, `const say = (...words: unknown[]): void => console.log(words.join(" "));`),
    };
  })();

  for (const file of ["main.mjs", "typed.ts"] as const) {
    test(`part ${number} of ${parts}, ${file}`, async () => {
      const programs = await written;
      expect(programs.modules).toBeGreaterThan(10);
      using dir = tempDir("every-export", {
        "main.mjs": programs["main.mjs"],
        "typed.ts": programs["typed.ts"],
        "package.json": `{ "name": "every-export" }`,
      });
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
      const plain = await run(bunExe(), file);
      expect(plain.exitCode).toBe(0);
      const build = await run(bunExe(), "build", "--compile", "--aot", file, "--outfile", "app");
      expect(build.stderr + build.stdout).not.toContain("error:");
      expect(build.exitCode).toBe(0);
      const compiled = await run(join(String(dir), "app"));
      expect(compiled.stdout.split("\n")).toEqual(plain.stdout.split("\n"));
      expect(compiled.exitCode).toBe(0);
    }, 170_000);
  }
}
