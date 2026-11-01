// The run time looks at every exception scope that it leaves behind, on the roads that a mock takes in a compiled test run.
//
// ONLY A BUILD WITH ASSERTIONS CAN FAIL THIS: BUN_JSC_validateExceptionChecks does nothing elsewhere. Of CI's lanes that is x64-asan. On every other build the cases only say that the run passes.
// The validator ends the process at the first scope that nobody looked at, so one fault hides the next: three stood one behind the other on these roads on one evening.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const plugin = `Bun.plugin({ name: "p", setup(build) { build.onLoad({ filter: /served\\.js$/ }, async () => ({ contents: 'export const s = "served";', loader: "js" })); } });`;
const projects: Record<string, Record<string, string>> = {
  "a mock and an import()": {
    "k.js": `export const x = "real";\n`,
    "m.test.js": `import { test, vi } from "bun:test";
test("x", async () => { vi.doMock("./k.js", () => ({ x: "mock" })); console.log("seen", (await import("./k.js")).x); });\n`,
  },
  "a mock beside a file that a plugin serves": {
    "k.js": `export const x = "real";\n`,
    "served.js": `export const s = "file";\n`,
    "user.js": `import { x } from "./k.js"; import { s } from "./served.js"; export const seen = x + "/" + s;\n`,
    "m.test.js": `import { test, vi } from "bun:test";
test("x", async () => { ${plugin} vi.doMock("./k.js", () => ({ x: "mock" })); console.log("seen", (await import("./user.js")).seen); });\n`,
  },
  "a mock that is taken back": {
    "k.js": `export const x = "real";\n`,
    "m.test.js": `import { test, vi } from "bun:test";
test("x", async () => { vi.doMock("./k.js", () => ({ x: "mock" })); console.log("seen", (await import("./k.js")).x); vi.doUnmock("./k.js"); });\n`,
  },
};

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
]) {
  test.each(Object.entries(projects))(`%s, ${way}`, async (_, files) => {
    using dir = tempDir("aot-mock-exception-checks", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "--aot"],
      cwd: String(dir),
      env: { ...bunEnv, BUN_JSC_validateExceptionChecks: "1", BUN_DEBUG_TEST_AOT_WORDS: words },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const unchecked = /Unchecked JS exception:\s*[^\n]*\n[^\n]*\n[^\n]*/.exec(stdout + stderr)?.[0] ?? null;
    expect({ unchecked, seen: /^seen .*$/m.exec(stdout)?.[0]?.startsWith("seen mock") ?? false, exitCode }).toEqual({
      unchecked: null,
      seen: true,
      exitCode: 0,
    });
  });
}
