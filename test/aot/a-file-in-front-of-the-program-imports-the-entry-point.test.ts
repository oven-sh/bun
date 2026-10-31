import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// A file that is loaded from the disk ahead of the program calls import() on the entry point. It gets the namespace in the turn in which it gets it under `bun run`,
// and ahead of a file of the program that calls import() on the entry point while the graph is loaded.

const counts = `globalThis.turns = 0;
const count = () => {
  if (++globalThis.turns < 30) Promise.resolve().then(count);
};
count();
`;
const asks = `console.log("first begins");
import("./main.mjs").then(namespace => console.log("first gets", namespace.answer, "in turn", globalThis.turns));
console.log("first ends");
module.exports = {};
`;
const inFront = `console.log("the file in front runs");
import(Bun.main).then(namespace => console.log("the file in front gets", namespace.answer, "in turn", globalThis.turns));
`;
const main = (imports: string, end: string) =>
  `${imports}console.log("main runs");\nexport const answer = 42;\n${counts}if (process.argv.length > 99) ${end}import(process.argv[99]);\n`;

const programs: Record<string, Record<string, string>> = {
  "a file of the program asks too": {
    "main.mjs": main(`import "./first.cjs";\nimport "./last.cjs";\n`, "await "),
    "first.cjs": asks,
    "last.cjs": `console.log("the last file runs");\nmodule.exports = {};\n`,
    "in-front.mjs": inFront,
  },
  "the entry point awaits nothing": {
    "main.mjs": main(`import "./first.cjs";\n`, ""),
    "first.cjs": asks,
    "in-front.mjs": inFront,
  },
  "nobody else asks": {
    "main.mjs": main(`import "./first.cjs";\n`, "await "),
    "first.cjs": `console.log("first runs");\nmodule.exports = {};\n`,
    "in-front.mjs": inFront,
  },
  "the file in front awaits the import": {
    "main.mjs": main(`import "./first.cjs";\n`, "await "),
    "first.cjs": asks,
    "in-front.mjs": `console.log("the file in front runs");
console.log("the file in front gets", (await import(Bun.main)).answer, "in turn", globalThis.turns);
`,
  },
};

// None of the programs imports a built-in module, and a build that allows code from disk would compile all of them.
const flags = ["--aot-allow-code-from-disk", "--no-builtin-modules"];

for (const [name, files] of Object.entries(programs)) {
  test.concurrent(
    name,
    async () => {
      using dir = tempDir("a-file-in-front-of-the-program-imports-the-entry-point", files);
      const executable = join(String(dir), isWindows ? "main.exe" : "main");
      const build = await run(
        [bunExe(), "build", "--compile", "--aot", ...flags, "main.mjs", "--outfile", executable],
        String(dir),
      );
      expect({ stderr: build.exitCode ? build.stderr : "", exitCode: build.exitCode }).toEqual({
        stderr: "",
        exitCode: 0,
      });

      // In which step of a load a file runs goes by the thread that transpiles it.
      const env = { ...bunEnv, BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1" };
      for (const option of ["--preload", "--import"]) {
        const plain = await run([bunExe(), option, "./in-front.mjs", "main.mjs"], String(dir), env);
        const compiled = await run([executable], String(dir), { ...env, BUN_OPTIONS: `${option} ./in-front.mjs` });
        expect(plain.stdout).toContain("the file in front gets 42");
        expect({ option, stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
          option,
          stdout: plain.stdout,
          exitCode: plain.exitCode,
        });
      }
    },
    600_000,
  );
}
