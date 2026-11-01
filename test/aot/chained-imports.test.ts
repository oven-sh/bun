// A call of import() made once an earlier call has settled, while others of that turn still wait.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const files = {
  "package.json": `{ "name": "p" }`,
  "a.mjs": ``,
  "b.mjs": ``,
  "c.mjs": `import "./c1.mjs";\n`,
  "c1.mjs": `import "./c2.mjs";\n`,
  "c2.mjs": ``,
  "d.mjs": `import "./c.mjs";\n`,
  "a.test.mjs": `test("t", async () => {
  const settled = [];
  await Promise.all([
    import("./a.mjs").then(() => import("./d.mjs")).then(() => settled.push("d")),
    import("./b.mjs").then(() => settled.push("b")),
    import("./c.mjs").then(() => settled.push("c")),
  ]);
  console.log("| " + settled.join(" "));
});
`,
};

test.each([
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
])("a graph settles behind the call it shares a module with, %s", async (_, words) => {
  using dir = tempDir("aot-chained-imports", files);
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", "--aot"],
    cwd: String(dir),
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([proc.stdout.text(), proc.exited]);
  expect({ lines: stdout.split("\n").filter(line => line.startsWith("| ")), exitCode }).toEqual({
    lines: ["| b c d"],
    exitCode: 0,
  });
});
