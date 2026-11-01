import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { waysFor } from "./harness/ways";
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

for (const [index, [title, [factory, user]]] of Object.entries(factories).entries()) {
  test.concurrent(title, async () => {
    using directory = tempDir("import-behind-factory", project(factory));
    const plain = await report(String(directory), []);
    expect(plain.printed).toContain(user);
    expect(plain.printed).toContain("| the next file real v");
    for (const words of waysFor([undefined, "TestRunLayers:2"], index === 0))
      expect(await report(String(directory), ["--aot"], words)).toEqual(plain);
  });
}

// The import() is called at the top level of a module that the imported graph imports back: it must not wait for that module.
test.concurrent(
  "the imported module imports the one that awaits it",
  async () => {
    using directory = tempDir("import-behind-factory-cycle", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "lib.mjs": `export const v = "real v";`,
      "x.mjs": `import { v } from "./lib.mjs";\nimport { name } from "./referrer.mjs";\nexport const seen = () => v + " " + name;`,
      "referrer.mjs": `export const name = "referrer";\nconst x = await import("./x.mjs");\nexport const seen = x.seen;`,
      "a.test.mjs": `
        import { test, vi } from "bun:test";
        import { seen } from "./referrer.mjs";
        vi.mock("./lib.mjs", async importOriginal => {
          await new Promise(resolve => setTimeout(resolve, 30));
          return { ...(await importOriginal()), v: "mock v" };
        });
        test("settles", () => console.log("| " + seen()));`,
    });
    const plain = await report(String(directory), []);
    expect(plain.printed).toEqual(["| mock v referrer"]);
    expect(await report(String(directory), ["--aot"])).toEqual(plain);
    expect(await report(String(directory), ["--aot"], "TestRunLayers:2")).toEqual(plain);
  },
  120_000,
);

// The second import() comes to a mock whose factory the first one has called.
test.concurrent(
  "two imports at once",
  async () => {
    using directory = tempDir("import-behind-factory-twice", {
      ...project(`async () => (await later(), { v: "mock v", kept: "mock kept" })`),
      "other.mjs": `import { v, kept } from "./lib.mjs";\nexport const both = v + " " + kept;`,
      "a.test.mjs": `
        import { beforeAll, mock, test } from "bun:test";
        const later = () => new Promise(resolve => setTimeout(resolve, 30));
        beforeAll(() => {
          mock.module("./lib.mjs", async () => (await later(), { v: "mock v", kept: "mock kept" }));
        });
        test("imports", async () => {
          const [user, other] = await Promise.all([import("./user.mjs"), import("./other.mjs")]);
          console.log("| user", user.v, user.kept, "| other", other.both);
        });`,
    });
    const plain = await report(String(directory), []);
    expect(plain.printed).toContain("| user mock v mock kept | other mock v mock kept");
    expect(await report(String(directory), ["--aot"])).toEqual(plain);
    expect(await report(String(directory), ["--aot"], "TestRunLayers:2")).toEqual(plain);
  },
  120_000,
);
