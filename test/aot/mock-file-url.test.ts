import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const factory = `() => ({ name: "mocked" })`;
const resolved = `import.meta.resolve("./dep")`;
const head = `import { test, mock, vi } from "bun:test";`;
const lays = (lay: string, after = "") =>
  `${head}\ntest("a", async () => { ${lay}; console.log("SEEN", await (await import("./src/uses-dep")).seen()); ${after} });\n`;
const imports = (name: string) => `import { name } from "${name}";\nexport const seen = () => name;\n`;

type Case = [name: string, seen: string[], files: Record<string, string>];
const cases: Case[] = [
  [
    "an importer that leaves the extension out",
    ["SEEN mocked"],
    { "a.test.ts": lays(`mock.module(${resolved}, ${factory})`), "src/uses-dep.ts": imports("../dep") },
  ],
  [
    "an importer that spells the extension",
    ["SEEN real"],
    { "a.test.ts": lays(`mock.module(${resolved}, ${factory})`), "src/uses-dep.ts": imports("../dep.ts") },
  ],
  [
    "require()",
    ["SEEN mocked"],
    {
      "a.test.ts": lays(`mock.module(${resolved}, ${factory})`),
      "src/uses-dep.ts": `export const seen = () => require("../dep").name;\n`,
    },
  ],
  [
    "import()",
    ["SEEN mocked"],
    {
      "a.test.ts": lays(`mock.module(${resolved}, ${factory})`),
      "src/uses-dep.ts": `export const seen = async () => (await import("../dep")).name;\n`,
    },
  ],
  [
    "the href of a URL",
    ["SEEN mocked"],
    {
      "a.test.ts": lays(`mock.module(new URL("./dep", import.meta.url).href, ${factory})`),
      "src/uses-dep.ts": imports("../dep"),
    },
  ],
  [
    "another extension",
    ["SEEN mocked"],
    {
      "a.test.ts": lays(`mock.module(import.meta.resolve("./dep.js"), ${factory})`),
      "src/uses-dep.ts": imports("../dep.js"),
    },
  ],
  [
    "another extension than the importer's",
    ["SEEN real"],
    {
      "a.test.ts": lays(`mock.module(import.meta.resolve("./dep.js"), ${factory})`),
      "src/uses-dep.ts": imports("../dep"),
    },
  ],
  [
    "a folder",
    ["SEEN mocked"],
    {
      "a.test.ts": lays(`mock.module(new URL("./lib", import.meta.url).href, ${factory})`),
      "lib/index.ts": `export const name = "real";\n`,
      "src/uses-dep.ts": imports("../lib"),
    },
  ],
  [
    "vi.doMock and vi.doUnmock",
    ["SEEN mocked", "SEEN real"],
    {
      "a.test.ts": lays(
        `vi.doMock(${resolved}, ${factory})`,
        `vi.doUnmock(${resolved}); vi.resetModules(); console.log("SEEN", (await import("./src/uses-dep")).seen());`,
      ),
      "src/uses-dep.ts": imports("../dep"),
    },
  ],
  [
    "the next file",
    ["SEEN mocked", "SEEN real"],
    {
      "a.test.ts": lays(`mock.module(${resolved}, ${factory})`),
      "b.test.ts": `${head}\ntest("b", async () => { console.log("SEEN", (await import("./src/uses-dep")).seen()); });\n`,
      "src/uses-dep.ts": imports("../dep"),
    },
  ],
  [
    "no such file",
    ["SEEN real"],
    {
      "a.test.ts": lays(`mock.module(import.meta.resolve("./nothing"), ${factory})`),
      "src/uses-dep.ts": imports("../dep"),
    },
  ],
];
const mixed: Case[] = [
  [
    "two importers",
    ["SEEN mocked", "SEEN real"],
    {
      "a.test.ts": lays(
        `mock.module(${resolved}, ${factory})`,
        `console.log("SEEN", (await import("./src/other")).seen());`,
      ),
      "src/uses-dep.ts": imports("../dep"),
      "src/other.ts": imports("../dep.ts"),
    },
  ],
  [
    "one importer",
    ["SEEN mocked real"],
    {
      "a.test.ts": lays(`mock.module(${resolved}, ${factory})`),
      "src/uses-dep.ts": `export const seen = async () => (await import("../dep")).name + " " + (await import("../dep.ts")).name;\n`,
    },
  ],
];

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, exitCode } = await run([bunExe(), "test", ...flags], directory, env);
  return { seen: stdout.split("\n").filter(line => line.startsWith("SEEN")), exitCode };
}

async function holdAgainstPlain(seen: string[], files: Record<string, string>) {
  using dir = tempDir("aot-mock-file-url", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "dep.ts": `export const name = "real";\n`,
    ...files,
  });
  const [plain, oneProgram, layers] = await Promise.all([
    runTests(String(dir), undefined),
    runTests(String(dir), undefined, "--aot"),
    runTests(String(dir), "TestRunLayers:2", "--aot"),
  ]);
  const expected = { seen, exitCode: 0 };
  expect({ plain, oneProgram, layers }).toEqual({ plain: expected, oneProgram: expected, layers: expected });
}

test.concurrent.each(cases)(
  "a mock under a file URL reaches whoever writes that name: %s",
  (_, seen, files) => holdAgainstPlain(seen, files),
  240_000,
);

test.failing.each(mixed)(
  "a mock under a file URL leaves the other spelling of the file alone: %s",
  (_, seen, files) => holdAgainstPlain(seen, files),
  240_000,
);
