// Calls of import() that meet one graph from two ends. The graph that was asked for first runs first, so a cycle is entered where the first call enters it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const cycle = {
  "a.mjs": `import { fromB } from "./b.mjs";\nexport const fromA = "A" + fromB;\n`,
  "b.mjs": `import { fromA } from "./a.mjs";\nexport const fromB = "B";\nexport const later = () => fromA;\n`,
};
const both = `await Promise.all([import("./a.mjs"), import("./b.mjs")])`;
const say = `console.log("| " + a.fromA + " " + b.later());`;

const projects: Record<string, { files: Record<string, string>; lines: string[] }> = {
  "two calls at the top of a test file": {
    files: { ...cycle, "a.test.mjs": `const [a, b] = ${both};\ntest("t", () => {\n  ${say}\n});\n` },
    lines: ["AB AB"],
  },
  "a module calls for what an earlier call is loading": {
    files: {
      "a.mjs": `import { fromC } from "./c.mjs";\nconsole.log("| a sees " + fromC);\n`,
      "b.mjs": `console.log("| b starts");\nawait import("./c.mjs");\nconsole.log("| b ends");\n`,
      "c.mjs": `import "./a.mjs";\nconsole.log("| c");\nexport const fromC = "C";\n`,
      "a.test.mjs": `test("t", async () => {\n  await Promise.all([import("./a.mjs"), import("./b.mjs")]);\n});\n`,
    },
    lines: ["b starts", "c", "a sees C", "b ends"],
  },
  "a module calls for the root of an earlier call": {
    files: {
      "a.mjs": `import "./c.mjs";\nconsole.log("| a");\n`,
      "b.mjs": `console.log("| b starts");\nawait import("./a.mjs");\nconsole.log("| b ends");\n`,
      "c.mjs": `console.log("| c");\n`,
      "a.test.mjs": `test("t", async () => {\n  const first = import("./a.mjs").then(() => console.log("| a is in"));\n  await Promise.all([first, import("./b.mjs")]);\n});\n`,
    },
    lines: ["b starts", "c", "a", "a is in", "b ends"],
  },
};

async function runTests(files: Record<string, string>, words: string) {
  using dir = tempDir("aot-import-cycles", { "package.json": `{ "name": "p" }`, ...files });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--aot"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = stdout
    .split("\n")
    .filter(line => line.startsWith("| "))
    .map(line => line.slice(2));
  return { lines, counts: /^ *\d+ pass\n *\d+ fail$/m.exec(stderr)?.[0].replace(/\s+/g, " ").trim(), exitCode };
}

// The lines are pinned: under load plain Bun, which reads texts on other threads, enters such a graph from either end.
for (const [way, words] of [["as one program", "TestRunLayers:0"]]) {
  test.each(Object.entries(projects))(`%s, ${way}`, async (_, { files, lines }) => {
    expect(await runTests(files, words)).toEqual({ lines, counts: "1 pass 0 fail", exitCode: 0 });
  });
}
