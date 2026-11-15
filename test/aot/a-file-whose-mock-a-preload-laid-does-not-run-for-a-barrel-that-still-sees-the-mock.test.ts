import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A barrel that a preload loaded under a mock stays linked to that mock behind its end: `bun test` never runs the real file for it.
const projectOf = (gauge: string, preload: string, testFile: string) => ({
  "package.json": `{ "name": "made-up", "type": "module" }\n`,
  "bunfig.toml": `[test]\npreload = ["./preload.js"]\n`,
  [gauge]: gauge.endsWith(".cjs")
    ? `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexports.held = 1;\n`
    : `globalThis.runs = (globalThis.runs ?? 0) + 1;\nexport const held = 1;\n`,
  "porch.js": `export * from "./${gauge}";\n`,
  "preload.js": preload,
  "a_test.js": testFile,
});

async function linesOf(project: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("aot-a-file-whose-mock-a-preload-laid", project);
  const { stdout } = await run([bunExe(), "test", ...flags, "./a_test.js"], String(dir), { ...bunEnv, NO_COLOR: "1" });
  return stdout.split("\n").filter(line => line.startsWith("SAID"));
}

test.failing(
  "a CommonJS file, and the test file imports the barrel by a statement: it prints what bun test prints: a wrong answer today: under `bun test --aot` the file has run once, where `bun test` never runs it",
  async () => {
    const project = projectOf(
      "gauge.cjs",
      `import { vi } from "bun:test";
vi.doMock("./gauge.cjs", () => ({ lent: 1 }));
await import("./porch.js");
vi.doUnmock("./gauge.cjs");
`,
      `import { test } from "bun:test";
import * as early from "./porch.js";
test("the barrel still shows the mock", () => {
  console.log("SAID", globalThis.runs ?? 0, Object.keys(early).sort().join());
});
`,
    );
    const plain = await linesOf(project);
    expect(plain).toEqual(["SAID 0 lent"]);
    expect(await linesOf(project, "--aot")).toEqual(plain);
  },
);
