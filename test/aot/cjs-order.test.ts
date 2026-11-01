// When does a CommonJS file run that an ES module imports by a statement?
//
// `bun run` runs it while it loads the graph, ahead of every ES module of the graph. In which order such files run among themselves depends on the
// transpiler: on one thread (BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1) level by level, always; at default flags each when its text comes back from
// a thread, so the order differs from run to run (about one run in seven on a busy machine). Compiled code runs them level by level. The stored programs
// under ./parallel are held against `bun run` on one thread, so they pin that order and never see the race. Nothing here tests it either: it has no
// right answer.
//
// This file is about what does not waver. `bun run` has two loaders. The one behind `require` takes `.cjs` for CommonJS. The one behind `import` asks the
// package alone, so a `.cjs` file whose text uses nothing of CommonJS (no `module`, `exports`, `require`, "use strict") is an ES module to it: it runs in
// its turn among the modules, unless a `require` has come to it first. A polyfill that only sets a global is such a file.
//
// Now and then `bun run` runs such a file a second time, once for each loader. Compiled code runs it once, as Node.js does: a line that `bun run` prints a
// second time is dropped before the two are compared.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const log = `const log = (...words) => console.log(words.join(" "));\n`;
const requiresA = `${log}log("b start");\nrequire("./a.cjs");\nlog("b end");\n`;
const module2 = `${log}import "./b.cjs";\nlog("m2");\n`;
const usesNothing = `${log}log("a");\n`;
const main = `${log}import "./m2.mjs";\nimport "./a.cjs";\nlog("main");\n`;

const forms: Record<string, { files: Record<string, string>; lines: string }> = {
  "a deeper file requires it ahead of its turn": {
    files: { "main.mjs": main, "m2.mjs": module2, "b.cjs": requiresA, "a.cjs": usesNothing },
    lines: "b start | a | b end | m2 | main",
  },
  "it only sets a global": {
    files: {
      "main.mjs": main,
      "m2.mjs": module2,
      "b.cjs": `${log}log("b start", typeof globalThis.polyfilled);\nrequire("./a.cjs");\nlog("b end", typeof globalThis.polyfilled);\n`,
      "a.cjs": `globalThis.polyfilled = true;\n`,
    },
    lines: "b start undefined | b end boolean | m2 | main",
  },
  "it queues a job": {
    files: {
      "main.mjs": main,
      "m2.mjs": module2,
      "b.cjs": requiresA,
      "a.cjs": `${usesNothing}queueMicrotask(() => log("a job"));\n`,
    },
    lines: "b start | a | b end | a job | m2 | main",
  },
  "the file that requires it lies two levels deeper": {
    files: {
      "main.mjs": `${log}import "./m3.mjs";\nimport "./a.cjs";\nlog("main");\n`,
      "m3.mjs": `${log}import "./m2.mjs";\nlog("m3");\n`,
      "m2.mjs": module2,
      "b.cjs": requiresA,
      "a.cjs": usesNothing,
    },
    lines: "b start | a | b end | m2 | m3 | main",
  },
  "it is required under a name made at run time": {
    files: {
      "main.mjs": main,
      "m2.mjs": module2,
      "b.cjs": `${log}log("b start");\nrequire(["./a", "cjs"].join("."));\nlog("b end");\n`,
      "a.cjs": usesNothing,
    },
    lines: "b start | a | b end | m2 | main",
  },
  "another such file stands between the two statements": {
    files: {
      "main.mjs": `${log}import "./m2.mjs";\nimport "./c.cjs";\nimport "./a.cjs";\nlog("main");\n`,
      "m2.mjs": module2,
      "b.cjs": requiresA,
      "a.cjs": usesNothing,
      "c.cjs": `${log}log("c");\n`,
    },
    lines: "b start | a | b end | m2 | c | main",
  },
  "the statement that imports it comes first": {
    files: {
      "main.mjs": `${log}import "./a.cjs";\nimport "./m2.mjs";\nlog("main");\n`,
      "m2.mjs": module2,
      "b.cjs": requiresA,
      "a.cjs": usesNothing,
    },
    lines: "b start | a | b end | m2 | main",
  },
  "both files are imported by one module": {
    files: {
      "main.mjs": `${log}import "./b.cjs";\nimport "./a.cjs";\nlog("main");\n`,
      "b.cjs": requiresA,
      "a.cjs": usesNothing,
    },
    lines: "b start | a | b end | main",
  },
  "the graph lies below an import()": {
    files: {
      "main.mjs": `${log}log("main start");\nawait import("./top.mjs");\nlog("main end");\n`,
      "top.mjs": `${log}import "./m2.mjs";\nimport "./a.cjs";\nlog("top");\n`,
      "m2.mjs": module2,
      "b.cjs": requiresA,
      "a.cjs": usesNothing,
    },
    lines: "main start | b start | a | b end | m2 | top | main end",
  },
  // The loader behind `require` reads all that is imported below the module: to it the file is CommonJS, and it lies a level higher than b.cjs.
  "the graph lies below a require()": {
    files: {
      "main.cjs": `${log}log("main start");\nrequire("./top.mjs");\nlog("main end");\n`,
      "top.mjs": `${log}import "./m2.mjs";\nimport "./a.cjs";\nlog("top");\n`,
      "m2.mjs": module2,
      "b.cjs": requiresA,
      "a.cjs": usesNothing,
    },
    lines: "main start | a | b start | b end | m2 | top | main end",
  },
  "nobody requires it": {
    files: { "main.mjs": main, "m2.mjs": module2, "b.cjs": `${log}log("b");\n`, "a.cjs": usesNothing },
    lines: "b | m2 | a | main",
  },
  "it is an ES module by its name": {
    files: {
      "main.mjs": `${log}import "./m2.mjs";\nimport "./a.mjs";\nlog("main");\n`,
      "m2.mjs": module2,
      "b.cjs": `${log}log("b start");\nrequire("./a.mjs");\nlog("b end");\n`,
      "a.mjs": usesNothing,
    },
    lines: "b start | a | b end | m2 | main",
  },
};

async function run(cmd: string[], cwd: string, env = bunEnv) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

const linesOf = (stdout: string) => stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
const withoutSecondRuns = (lines: string[]) => lines.filter((line, index) => lines.indexOf(line) === index);

test.concurrent.each(Object.entries(forms))(
  "an executable: %s",
  async (_, { files, lines }) => {
    using dir = tempDir("aot-cjs-order", files);
    const entry = Object.keys(files)[0];
    const plain = await run([bunExe(), entry], String(dir));
    expect({ lines: withoutSecondRuns(linesOf(plain.stdout)).join(" | "), exitCode: plain.exitCode }).toEqual({
      lines,
      exitCode: 0,
    });
    const executable = join(String(dir), "executable");
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", `./${entry}`, "--outfile", executable],
      String(dir),
    );
    expect({ stderr: built.exitCode === 0 ? "" : built.stderr, exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    const compiled = await run([executable], String(dir));
    expect({ lines: linesOf(compiled.stdout).join(" | "), exitCode: compiled.exitCode }).toEqual({
      lines,
      exitCode: 0,
    });
  },
  600_000,
);

const testFile = (entry: string) => `import { test } from "bun:test";
test("loads", async () => {
  await import("./${entry}");
});
`;

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test.concurrent.each(Object.entries(forms))(
    `a test run ${way}: %s`,
    async (_, { files }) => {
      using dir = tempDir("aot-cjs-order-test-run", { ...files, "order.test.mjs": testFile(Object.keys(files)[0]) });
      const plain = await run([bunExe(), "test"], String(dir));
      const compiled = await run([bunExe(), "test", "--aot"], String(dir), {
        ...bunEnv,
        BUN_DEBUG_TEST_AOT_WORDS: words,
      });
      if (compiled.exitCode !== 0) console.error(compiled.stderr);
      expect({ lines: linesOf(compiled.stdout), exitCode: compiled.exitCode }).toEqual({
        lines: withoutSecondRuns(linesOf(plain.stdout)),
        exitCode: plain.exitCode,
      });
    },
    600_000,
  );
}
