// No executable holds a preload, nor a file that the preloads alone import: it is the tests' own and may replace a built-in, as under plain `bun test`.
// A file that the product imports too stays the product's: there the assignment throws, as in the executable.
// Every test file runs behind the preloads, so where one of those can't be compiled each test file fails by itself and the run ends with its summary.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const shared = {
  "bunfig.toml": `[test]\npreload = ["./setup/preload.ts"]\n`,
  "tests/a.test.ts": `import { expect, test } from "bun:test";
import { check } from "../src/app";
test("replaced", () => { expect(check("no-such-encoding")).toBe(true); });
`,
  "tests/b.test.ts": `import { expect, test } from "bun:test";
test("healthy", () => { expect(1 + 1).toBe(2); });
`,
};
const reachedByPreloadAlone = {
  ...shared,
  "setup/preload.ts": `import "./patch";\n`,
  "setup/patch.ts": `import "./deeper/patch";\n`,
  "setup/deeper/patch.ts": `Buffer.isEncoding = () => true;\n`,
  "src/app.ts": `export function check(name: string): boolean { return Buffer.isEncoding(name); }\n`,
};
// `src/main.ts` lies on disk, and no test imports it: it speaks for the product.
const reachedByProductToo = {
  ...shared,
  "src/main.ts": `import { check } from "./app";\ncheck("utf8");\n`,
  "setup/preload.ts": `import "../src/patch";\n`,
  "src/patch.ts": `Buffer.isEncoding = () => true;\nexport const patched = true;\n`,
  "src/app.ts": `import { patched } from "./patch";
export function check(name: string): boolean { return patched && Buffer.isEncoding(name); }
`,
};

const helperBesideTheTests = {
  "tests/a.test.ts": `import { expect, test } from "bun:test";
import { patch } from "../test-utils/patch";
test("replaced", () => { patch(); expect(Buffer.isEncoding("no-such-encoding")).toBe(true); });
`,
  "test-utils/patch.ts": `export function patch(): void { Buffer.isEncoding = () => true; }\n`,
};
// `src/main.ts` lies on disk, and no test imports it.
const helperOfProductToo = {
  ...helperBesideTheTests,
  "src/main.ts": `import { patch } from "../test-utils/patch";\npatch();\n`,
};
const waysOut: [string, Record<string, string>][] = [
  [
    "it imports from bun:test",
    {
      ...helperOfProductToo,
      "test-utils/patch.ts": `import { mock } from "bun:test";\nexport function patch(): void { Buffer.isEncoding = mock(() => true); }\n`,
    },
  ],
  [
    "nothing but the tests imports it, wherever it lies",
    helperBesideTheTests,
  ],
  [
    "it is named as a preload",
    { ...helperOfProductToo, "bunfig.toml": `[test]\npreload = ["./test-utils/patch.ts"]\n` },
  ],
];

async function run(files: Record<string, string>, words: string) {
  using dir = tempDir("preload-imports", files);
  await using child = Bun.spawn({
    cmd: [bunExe(), "test", "--aot"],
    env: { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words },
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  const [stderr, exitCode] = await Promise.all([child.stderr.text(), child.exited]);
  return { stderr, exitCode };
}

// Over layers this had a fault and a cure of its own: the file could not replace the built-in though one program let it.
for (const [form, words] of [
  ["as the run is built by itself", ""],
]) {
  test.concurrent(`what the preloads alone import is the tests' own, ${form}`, async () => {
    const { stderr, exitCode } = await run(reachedByPreloadAlone, words);
    expect(stderr.split("\n").filter(line => /^(error|TypeError)\b/.test(line))).toEqual([]);
    expect(stderr).toContain(" 2 pass");
    expect(exitCode).toBe(0);
  });
}

test.concurrent("what the product imports too stays the product's, and the run says how it ended", async () => {
  const { stderr, exitCode } = await run(reachedByProductToo, "");
  // The build sees that the assignment always runs.
  expect(stderr).toContain("TS100014");
  expect(stderr).toContain("src/patch.ts:1:1");
  expect(stderr).toContain(" 0 pass");
  expect(stderr).toContain(" 2 fail");
  expect(stderr).toContain("Ran 2 tests across 2 files.");
  expect(exitCode).toBe(1);
});

test.concurrent("a helper that the product imports too is the product's, and the run says what to do", async () => {
  const { stderr, exitCode } = await run(helperOfProductToo, "");
  expect(stderr).toContain("TypeError: Cannot assign to Buffer.isEncoding");
  expect(stderr).toContain(`import from "bun:test" in it or name it as a preload`);
  expect(exitCode).toBe(1);
});

for (const [way, files] of waysOut) {
  test.concurrent(`such a helper is the tests' own where ${way}`, async () => {
    const { stderr, exitCode } = await run(files, "");
    expect(stderr.split("\n").filter(line => /^(error|TypeError)\b/.test(line))).toEqual([]);
    expect(stderr).toContain(" 1 pass");
    expect(exitCode).toBe(0);
  });
}
