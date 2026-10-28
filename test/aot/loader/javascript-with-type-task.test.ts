import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned, told } from "../run-programs";
import { test } from "../supported";
import { describeTree } from "./describe";

// No tsconfig.json: the default options have `strict` and `allowJs`. The code tasks of feature.ts and util.js are queued
// together, so the type task that feature.ts starts for util.js runs between them.
const files = {
  "index.js": 'import { feature } from "./feature.ts";\nimport { g } from "./util.js";\nconsole.log(feature, g());\n',
  "feature.ts": 'import { g } from "./util.js";\nexport const feature: number = g();\n',
  "util.js": "let calls = 0;\nexport function g() {\n  return ++calls;\n}\n",
};

test("JavaScript that a code task and a type task load keeps its type edge", () => {
  using graph = describeTree(files, ["index.js"]);

  expect(graph.diagnostics).toEqual([]);
  expect(graph.file("util.js").role).toBe("Inferred");
  expect(graph.file("feature.ts")).toMatchObject({ role: "Checked", typeEdges: ["util.js"], codeEdges: ["util.js"] });
  expect(graph.compiledFiles).toEqual(["util.js", "feature.ts", "index.js"]);
});

test("it builds, and prints what bun run prints", async () => {
  using dir = tempDir("aot-loader-type-task", files);
  const folder = String(dir);
  const program = join(folder, isWindows ? "program.exe" : "program");
  await slot(async () => {
    const plain = await spawned([bunExe(), "run", "./index.js"], folder, bunEnv);
    expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "1 2\n", exitCode: 0 });

    const command = [bunExe(), "build", "--compile", "--aot", "./index.js", "--outfile", program];
    built(await spawned(command, folder, bunEnv));
    const compiled = await spawned([program], folder, { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect({ ...told(compiled), signal: compiled.signal }).toEqual({ ...told(plain), signal: null });
  });
}, 120_000);
