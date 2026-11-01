import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { expectLayers } from "./harness/layers";
import { reportsToTheRunnerAlone } from "./harness/without-core-dump";
import { test } from "./supported";

const filler = Array.from({ length: 7000 }, (_, index) => `export function filler${index}(x) { return x + ${index}; }`);
const testFile = (body: string) => `import { filler1 } from "./filler.mjs";
void filler1;
import { test, vi } from "bun:test";
${body}
`;
const reads = (name: string) =>
  `test("${name}", async () => {
  const subject = await import("./subject.js");
  console.error("SEEN ${name}", subject.f(), subject.value);
});`;
const earlier = {
  "by import()": reads("one"),
  "by a statement": `import { f, value } from "./subject.js";\ntest("one", () => { console.error("SEEN one", f(), value); });`,
  "under a mock of its own": `test("one", async () => {
  vi.doMock("./dep.js", () => ({ value: "first", get: () => "first" }));
  const subject = await import("./subject.js");
  console.error("SEEN one", subject.f(), subject.value);
});`,
};
const project = (first: string) =>
  tempDir("aot-do-mock-over-layers", {
    "package.json": `{ "name": "mocks", "type": "module" }`,
    "filler.mjs": filler.join("\n") + "\n",
    "dep.js": `export const value = "real";\nexport const get = () => "real";\n`,
    "subject.js": `import { value, get } from "./dep.js";\nexport { value } from "./dep.js";\nexport const f = () => [value, get()].join();\n`,
    "f1.test.js": testFile(first),
    "f2.test.js": testFile(`test("two", async () => {
  vi.doMock("./dep.js", () => ({ value: "mocked", get: () => "mocked" }));
  const subject = await import("./subject.js");
  console.error("SEEN two", subject.f(), subject.value);
});`),
    "f3.test.js": testFile(reads("three")),
  });
const env = reportsToTheRunnerAlone({ ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm" });

async function seen(cwd: string, ...flags: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--parallel=1", "--no-isolate", "."],
    cwd,
    env,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([proc.stderr.text(), proc.exited]);
  if (flags.includes("--aot")) expectLayers(stderr);
  return { lines: stderr.split("\n").filter(line => /^SEEN|^error|^panic|TypeError/.test(line)), exitCode };
}

test.concurrent.each(Object.entries(earlier))(
  "a module that an earlier test file loaded %s sees the mock",
  async (_, first) => {
    using dir = project(first);
    const [plain, compiled] = await Promise.all([
      seen(String(dir)),
      seen(String(dir), "--aot", "--aot-memory-limit", "1MB"),
    ]);
    expect(plain.lines.slice(1)).toEqual(["SEEN two mocked,mocked mocked", "SEEN three real,real real"]);
    expect(compiled).toEqual(plain);
  },
  240_000,
);
