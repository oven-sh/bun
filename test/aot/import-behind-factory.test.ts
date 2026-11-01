import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// An import() that comes to a mock whose factory answers a promise goes on once the promise has settled, however long that takes.
const project = (factory: string) => ({
  "package.json": `{ "name": "p", "type": "module" }`,
  "lib.mjs": `console.log("| lib runs");\nexport const v = "real v";\nexport const kept = "kept";`,
  "user.mjs": `import { v, kept } from "./lib.mjs";\nexport { v, kept };`,
  "a.test.mjs": `
    import { beforeAll, mock, test, vi } from "bun:test";
    const later = () => new Promise(resolve => setTimeout(resolve, 30));
    beforeAll(() => {
      mock.module("./lib.mjs", ${factory});
    });
    test("imports", async () => {
      try {
        const user = await import("./user.mjs");
        console.log("| user", user.v, user.kept);
      } catch (error) {
        console.log("| user failed", error.message);
      }
    });`,
  "z.test.mjs": `
    import { test } from "bun:test";
    import { v } from "./lib.mjs";
    console.log("| the next file", v);
    test("reads", () => {});`,
});

const factories = {
  "it waits for a timer": [`async () => (await later(), { v: "mock v" })`, "| user mock v undefined"],
  "it waits for vi.importActual()": [
    `async () => ({ ...(await vi.importActual("./lib.mjs")), v: "mock v" })`,
    "| user mock v kept",
  ],
  "it waits for the original that it is handed": [
    `async original => ({ ...(await original()), v: "mock v" })`,
    "| user mock v kept",
  ],
  "it waits for both": [
    `async original => (await later(), { ...(await original()), v: "mock v" })`,
    "| user mock v kept",
  ],
  "it fails behind a timer": [
    `async () => (await later(), Promise.reject(new Error("no mock")))`,
    "| user failed no mock",
  ],
};

async function report(directory: string, flags: string[], words?: string) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], directory, env);
  const printed = (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("| "));
  const counts = stderr.match(/^ *\d+ (pass|fail)$/gm)?.map(line => line.trim());
  return { printed, counts, exitCode };
}

for (const [title, [factory, user]] of Object.entries(factories)) {
  test.concurrent(title, async () => {
    using directory = tempDir("import-behind-factory", project(factory));
    const plain = await report(String(directory), []);
    expect(plain.printed).toContain(user);
    expect(plain.printed).toContain("| the next file real v");
    expect(await report(String(directory), ["--aot"])).toEqual(plain);
    expect(await report(String(directory), ["--aot"], "TestRunLayers:2")).toEqual(plain);
  });
}
