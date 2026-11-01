import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { testOneByOne as test } from "./supported";

const files: Record<string, string> = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "two-tests.test.ts": `import { mock, test } from "bun:test";
let first: any;
test("first", async () => {
  const made = () => "mock 1";
  mock.module("node:dns", () => ({ getDefaultResultOrder: made, onlyInTheFirst: 1 }));
  first = await import("node:dns");
  console.log("SEEN two tests, first:", first.getDefaultResultOrder === made, first.getDefaultResultOrder());
});
test("second", async () => {
  const made = () => "mock 2";
  mock.module("node:dns", () => ({ getDefaultResultOrder: made, onlyInTheSecond: 2 }));
  console.log("SEEN two tests, what the first import gave:", first.getDefaultResultOrder(), Object.keys(first).join());
  const got: any = await import("node:dns");
  console.log("SEEN two tests, second:", got.getDefaultResultOrder === made, got.getDefaultResultOrder(), got === first);
  console.log("SEEN two tests, require:", require("node:dns").getDefaultResultOrder());
});
`,
  "five-times.test.ts": `import { mock, test } from "bun:test";
test("five times", async () => {
  const seen: string[] = [];
  for (const n of [1, 2, 3, 4, 5]) {
    mock.module("node:os", () => ({ hostname: () => "mock " + n }));
    seen.push((await import("node:os")).hostname());
  }
  console.log("SEEN five times:", seen.join());
});
`,
  "every-kind.test.ts": `import { mock, test } from "bun:test";
for (const name of ["node:util/types", "bun:jsc", "undici", "ws", "node:path", "zlib"]) {
  test(name, async () => {
    mock.module(name, () => ({ marker: "mock 1" }));
    const one = (await import(name)).marker;
    mock.module(name, () => ({ marker: "mock 2" }));
    console.log("SEEN", name + ":", one, (await import(name)).marker);
  });
}
`,
  "by-statement.test.ts": `import { mock, test } from "bun:test";
test("a file that imports by a statement", async () => {
  mock.module("node:url", () => ({ marker: "mock 1" }));
  const one = (await import("node:url") as any).marker;
  mock.module("node:url", () => ({ marker: "mock 2" }));
  console.log("SEEN by a statement:", one, (await import("./reader.ts")).read());
});
`,
  "reader.ts": `import * as url from "node:url";
export const read = () => (url as any).marker;
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

for (const [way, words] of [
  ["as one program", "TestRunLayers:0"],
  ["over one layer", "TestRunLayers:1"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
] as const) {
  test(`import() behind a second mock of a built-in module gets the second, ${way}`, async () => {
    using dir = tempDir("aot-mock-twice-layers", files);
    const plain = await runTests(String(dir), undefined);
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).toContain("SEEN two tests, second: true mock 2 true");
    expect(plain.stdout).toContain("SEEN five times: mock 1,mock 2,mock 3,mock 4,mock 5");
    expect(plain.stdout.length).toBe(12);
    expect(await runTests(String(dir), words, "--aot")).toEqual(plain);
  }, 180_000);
}
