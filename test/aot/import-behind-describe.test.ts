// What an import() loads that was called while a test file loaded runs behind that file's `describe` callbacks, so it meets a mock that one of them lays.
//
// A real package leans on it: its app calls import() for every file of a folder of routes as it loads, a route makes its gateway when it loads, and the test lays
// `jest.mock()` on the gateway inside `describe`.
//
// UNDER `bun test` THIS IS A RACE BY THE CLOCK, so no case here is held against it. It reads the text on another thread, and the runner turns the event loop once between the end of the
// test file and the callbacks: the thread is nearly always too late for that turn on a quiet machine, often in time on a loaded one, always in time behind 50 ms of work in the
// importing file, and with BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER=1 there is no thread and the route comes first. A compiled test run used to be like the last of these, every time.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { waysFor } from "./harness/ways";
import { test } from "./supported";

const route = `console.log("| the route runs");\nexport default 1;\n`;
const spec = (more = "") => `import { app } from "../src/app";
${more}
describe("d", () => {
  console.log("| the callback of describe");
  it("a", async () => { console.log("| the test"); expect(app).toBe(1); await new Promise(resolve => setTimeout(resolve, 20)); console.log("| the end of the test"); });
});
console.log("| the end of the test file");
`;

const projects: Record<string, { files: Record<string, string>; lines: string[] }> = {
  "a computed name": {
    files: {
      "src/app.ts": `const name = ["log", "in"].join("");\nimport(\`./routes/\${name}.ts\`).then(() => console.log("| import() has settled"));\nexport const app = 1;\n`,
      "src/routes/login.ts": route,
      "tests/a.spec.ts": spec(),
    },
    lines: [
      "the end of the test file",
      "the callback of describe",
      "the test",
      "the route runs",
      "import() has settled",
      "the end of the test",
    ],
  },
  "a literal name": {
    files: {
      "src/app.ts": `import("./routes/login.ts").then(() => console.log("| import() has settled"));\nexport const app = 1;\n`,
      "src/routes/login.ts": route,
      "tests/a.spec.ts": spec(),
    },
    lines: [
      "the end of the test file",
      "the callback of describe",
      "the test",
      "the route runs",
      "import() has settled",
      "the end of the test",
    ],
  },
  "the call stands in the test file": {
    files: {
      "src/app.ts": `export const app = 1;\n`,
      "src/routes/login.ts": route,
      "tests/a.spec.ts": spec(`import("../src/routes/login.ts").then(() => console.log("| import() has settled"));`),
    },
    lines: [
      "the end of the test file",
      "the callback of describe",
      "the test",
      "the route runs",
      "import() has settled",
      "the end of the test",
    ],
  },
  "work behind the call": {
    files: {
      "src/app.ts": `import("./routes/login.ts").then(() => console.log("| import() has settled"));\nfor (const start = performance.now(); performance.now() - start < 50; );\nexport const app = 1;\n`,
      "src/routes/login.ts": route,
      "tests/a.spec.ts": spec(),
    },
    lines: [
      "the end of the test file",
      "the callback of describe",
      "the test",
      "the route runs",
      "import() has settled",
      "the end of the test",
    ],
  },
  "the test file waits for the import() itself": {
    files: {
      "src/app.ts": `export const app = 1;\n`,
      "src/routes/login.ts": route,
      "tests/a.spec.ts": spec(`await import("../src/routes/login.ts"); console.log("| import() has settled");`),
    },
    lines: [
      "the route runs",
      "import() has settled",
      "the end of the test file",
      "the callback of describe",
      "the test",
      "the end of the test",
    ],
  },
  "a factory that the runner waits for calls import()": {
    files: {
      "src/app.ts": `export const app = 1;\n`,
      "src/routes/login.ts": route,
      "src/other.ts": `export const other = "real";\n`,
      "tests/a.spec.ts": spec(
        `import { mock } from "bun:test";\nimport { other } from "../src/other";\nmock.module("../src/other.ts", async () => { await import("../src/routes/login.ts"); console.log("| import() has settled"); return { other: "mock of " + other }; });`,
      ),
    },
    lines: [
      "the end of the test file",
      "the route runs",
      "import() has settled",
      "the callback of describe",
      "the test",
      "the end of the test",
    ],
  },
};

async function runTests(files: Record<string, string>, words: string) {
  using dir = tempDir("aot-import-behind-describe", { "package.json": `{ "name": "p" }`, ...files });
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

const ways = [
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
] as const;

// No case is about the layers. On a build without the turn that the text waits, the five cases that fail over two layers fail as one program too.
for (const [name, { files, lines }] of Object.entries(projects))
  for (const [way, words] of waysFor(ways, false))
    test(`${name}, ${way}`, async () => {
      expect(await runTests(files, words)).toEqual({ lines, counts: "1 pass 0 fail", exitCode: 0 });
    });

// The witness, one of the five: what the real package does.
for (const [way, words] of waysFor(ways, true)) {
  test(`a route meets the mock that describe lays, ${way}`, async () => {
    const ran = await runTests(
      {
        "src/app.ts": `import { readdirSync } from "fs";
import { join } from "path";
export const handlers: Record<string, () => string> = {};
readdirSync(join(__dirname, "routes")).map(async file => {
  handlers[file] = (await import(\`./routes/\${file}\`)).default;
});
`,
        "src/gateways/api.ts": `export class Api {\n  load(): string { return "real"; }\n}\n`,
        "src/gateways/index.ts": `export * from "./api";\n`,
        "src/routes/login.ts": `import { Api } from "../gateways";\nconst api = new Api();\nexport default (): string => api.load();\n`,
        "tests/login.spec.ts": `import { handlers } from "../src/app";
describe("d", () => {
  const load = jest.fn();
  jest.mock("../src/gateways/api", () => ({ Api: jest.fn().mockReturnValue({ load }) }));
  it("a", async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    load.mockReturnValueOnce("mocked");
    console.log("| " + handlers["login.ts"]());
  });
});
`,
      },
      words,
    );
    expect(ran).toEqual({ lines: ["mocked"], counts: "1 pass 0 fail", exitCode: 0 });
  });
}
