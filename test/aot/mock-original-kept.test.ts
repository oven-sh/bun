import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A package that imports a mocked package gets the original. It keeps it when the mock of a preload has ended in one test file and the package reads for the first time in the next.
test("a package reads the original in the test file behind the one that ended the mock of a preload", async () => {
  using dir = tempDir("aot-mock-original-kept", {
    "package.json": `{ "type": "module" }`,
    "bunfig.toml": `[test]\npreload = ["./setup.js"]\n`,
    "node_modules/dep/package.json": `{ "name": "dep", "type": "module", "main": "index.js" }`,
    "node_modules/dep/index.js": `export const value = () => "real";\n`,
    "node_modules/reads/package.json": `{ "name": "reads", "type": "module", "main": "index.js" }`,
    "node_modules/reads/index.js": `import { value } from "dep";\nexport const seen = () => value();\n`,
    "own.js": `import { value } from "dep";\nexport const mine = () => value();\n`,
    "setup.js": `import { vi } from "bun:test";
import { seen } from "reads";
import { mine } from "./own.js";
vi.mock("dep", () => ({ value: () => "preload" }));
globalThis.seen = seen;
globalThis.mine = mine;
`,
    "a.test.js": `import { test, vi } from "bun:test";
test("a", async () => {
  vi.doUnmock("dep");
  console.log("seen: a", (await import("dep")).value(), mine());
});
`,
    "b.test.js": `import { test } from "bun:test";
test("b", () => console.log("seen: b", seen(), mine()));
`,
  });
  const seenWith = async (...more: string[]) => {
    const { stdout, exitCode } = await run([bunExe(), "test", ...more], String(dir), bunEnv);
    return { lines: stdout.split("\n").filter(line => line.startsWith("seen: ")), exitCode };
  };
  const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
  expect(plain).toEqual({ lines: ["seen: a real preload", "seen: b real preload"], exitCode: 0 });
  expect(compiled).toEqual(plain);
}, 120_000);
