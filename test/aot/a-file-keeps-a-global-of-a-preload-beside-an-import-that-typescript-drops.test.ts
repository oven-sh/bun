// A file that imports a test module keeps a test global that a preload defined, also where TypeScript drops the import because nobody uses its names.
import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { run } from "./harness/run";
// One by one: the cases wait for the same two processes.
import { describe, testOneByOne as test } from "./supported";

// One import or export statement each, in a test file of its own.
const statements: Record<string, string> = {
  "a-name-that-is-used.ts": `import { mock } from "bun:test"; mock;`,
  "a-name-that-nothing-uses.ts": `import { mock } from "bun:test";`,
  "a-name-that-nothing-uses.tsx": `import { mock } from "bun:test";`,
  "a-name-that-nothing-uses.mts": `import { mock } from "bun:test";`,
  "a-name-that-nothing-uses.js": `import { mock } from "bun:test";`,
  "a-name-of-vitest-that-nothing-uses.ts": `import { vi } from "vitest";`,
  "a-name-of-jest-globals-that-nothing-uses.ts": `import { jest as j } from "@jest/globals";`,
  "a-default-that-nothing-uses.ts": `import runner from "bun:test";`,
  "a-namespace-that-nothing-uses.ts": `import * as runner from "bun:test";`,
  "a-namespace-of-vitest-that-nothing-uses.ts": `import * as runner from "vitest";`,
  "a-default-and-a-name-that-nothing-uses.ts": `import runner, { mock } from "bun:test";`,
  "a-default-beside-a-type.ts": `import runner, { type Mock } from "bun:test";`,
  "a-name-beside-a-type.ts": `import { type Mock, mock } from "bun:test";`,
  "a-name-in-a-type-query.ts": `import { mock } from "bun:test"; let m: typeof mock | undefined;`,
  "a-name-in-a-type.ts": `import { Mock } from "bun:test"; let m: Mock<() => void> | undefined;`,
  "a-name-in-dead-code.ts": `import { mock } from "bun:test"; if (false) mock;`,
  "a-namespace-that-is-exported.ts": `import * as runner from "bun:test"; export { runner };`,
  "a-type-in-a-declared-module.ts": `declare module "elsewhere" { import type { Mock } from "bun:test"; export const it: Mock<() => void>; }`,
  "import-type.ts": `import type { Mock } from "bun:test";`,
  "import-type-of-vitest.ts": `import type { Mock } from "vitest";`,
  "a-type-in-braces.ts": `import { type Mock } from "bun:test";`,
  "two-types-in-braces.ts": `import { type Mock, type Spy } from "bun:test";`,
  "empty-braces.ts": `import {} from "bun:test";`,
  "no-names.ts": `import "bun:test";`,
  "export-from.ts": `export { mock } from "bun:test";`,
  "export-star.ts": `export * from "bun:test";`,
  "export-type-from.ts": `export type { Mock } from "bun:test";`,
  "export-a-type-in-braces.ts": `export { type Mock } from "bun:test";`,
  "import-equals-that-nothing-uses.ts": `import runner = require("bun:test");`,
  "import-type-equals.ts": `import type runner = require("bun:test");`,
  "an-import-type.ts": `let m: import("bun:test").Mock<() => void> | undefined;`,
  "no-import.js": ``,
};
const toTestFile = (name: string) => name.replace(/\.(\w+)$/, ".test.$1");
const whose = `expect === Reflect.get(globalThis, "expect") ? "the global" : "the runner's"`;
const read = `[${whose}, typeof suite, typeof xit].join(" ")`;
const tsconfig = `{ "compilerOptions": { "target": "ESNext", "module": "ESNext", "strict": true, "typeRoots": ["./no-types-here"] } }`;
const files = {
  "tsconfig.json": tsconfig,
  "defines-expect.js": `globalThis.expect = value => ({ to: { equal(other) { return value === other; } } });\n`,
  ...Object.fromEntries(
    Object.entries(statements).map(([name, statement]) => [
      toTestFile(name),
      // The names of the other runner are declared nowhere.
      `${/\.[mc]?tsx?$/.test(name) ? "// @ts-nocheck\n" : ""}${statement}\ntest("${toTestFile(name)}", () => { console.log("row: ${toTestFile(name)}:", ${read}); });\n`,
    ]),
  ),
  // A file that is no test file decides for itself.
  "imports-a-name-that-nothing-uses.ts": `// @ts-nocheck\nimport { mock } from "bun:test";\nexport const read = () => ${read};\n`,
  "loads-a-file-that-is-no-test-file.test.js": `
import { read } from "./imports-a-name-that-nothing-uses.ts";
test("loads-a-file-that-is-no-test-file.test.js", () => { console.log("row: loads-a-file-that-is-no-test-file.test.js:", read()); });
`,
};

// With --isolate a preload runs in front of every test file, on a new global each time.
const isolated = {
  "tsconfig.json": tsconfig,
  "wraps-expect.ts": `// @ts-nocheck
import { Mock } from "bun:test";
import { read } from "./reads-expect.ts";
export type Spy = Mock<() => void>;
const ofRunner = expect;
console.log("row: the preload reads", read(), typeof ofRunner.extend);
globalThis.expect = Object.assign(value => ofRunner(value), { ofRunner });
`,
  "reads-expect.ts": `// @ts-nocheck\nimport { mock } from "bun:test";\nexport const read = () => (${whose});\n`,
  ...Object.fromEntries(
    ["a", "b", "c"].map(name => [
      `${name}.test.js`,
      `import { test } from "bun:test";
import { read } from "./reads-expect.ts";
test("${name}", () => { console.log("row: ${name} reads", read(), typeof expect.ofRunner); });
`,
    ]),
  ),
};

// oven-sh/bun#48169: a debug build of the engine ends at random where several threads link. Take this out with the WebKit version that has oven-sh/WebKit#1007.
const env = isDebug ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: "threads=1" } : bunEnv;

// What a run prints: the lines of the files, and the runner's line for each test.
async function report(flags: string[], directory: string, testFiles: string[]) {
  const command = [bunExe(), "test", ...flags, ...testFiles.map(file => "./" + file)];
  const { stdout, stderr, exitCode } = await run(command, directory, env);
  // The runner lists the failed tests once more at its end.
  const [results] = stderr.split(/^\d+ tests? failed:$/m);
  const verdicts = results.split("\n").filter(line => /^\((pass|fail|skip|todo)\) /.test(line));
  return {
    rows: stdout.split("\n").filter(line => line.startsWith("row: ")),
    verdicts: verdicts.map(line => line.replace(/ \[[\d.]+m?s\]$/, "")),
    exitCode,
  };
}

describe("a file keeps a global of a preload beside an import that TypeScript drops", () => {
  const testFiles = Object.keys(files).filter(name => name.includes(".test."));
  let asked: Promise<Awaited<ReturnType<typeof report>>[]> | undefined;
  const ask = () =>
    (asked ??= (async () => {
      using dir = tempDir("aot-dropped-test-imports", files);
      const flags = ["--preload=./defines-expect.js"];
      return [await report(flags, String(dir), testFiles), await report([...flags, "--aot"], String(dir), testFiles)];
    })());
  test("the run ends as under plain bun test", async () => {
    expect((await ask()).map(({ exitCode }) => exitCode)).toEqual([0, 0]);
  });
  test.each(testFiles)("%s", async file => {
    const [plain, compiled] = (await ask()).map(({ rows, verdicts }) => ({
      rows: rows.filter(line => line.startsWith(`row: ${file}:`)),
      verdicts: verdicts.filter(line => line.endsWith(" " + file)),
    }));
    expect(plain).toEqual({ rows: [expect.stringMatching(/^row: /)], verdicts: [`(pass) ${file}`] });
    expect(compiled).toEqual(plain);
  });

  test("with --isolate a preload finds in front of every test file what it finds in front of the first", async () => {
    using dir = tempDir("aot-dropped-test-imports-isolated", isolated);
    const flags = ["--isolate", "--preload=./wraps-expect.ts"];
    const testFiles = ["a.test.js", "b.test.js", "c.test.js"];
    const plain = await report(flags, String(dir), testFiles);
    expect(plain).toEqual({
      rows: ["a", "b", "c"].flatMap(name => [
        "row: the preload reads the runner's function",
        `row: ${name} reads the runner's function`,
      ]),
      verdicts: ["(pass) a", "(pass) b", "(pass) c"],
      exitCode: 0,
    });
    expect(await report([...flags, "--aot"], String(dir), testFiles)).toEqual(plain);
  });
});
