import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const imports = `import * as dep from "./dep.js";
import { viaUser } from "./user.js";
import { viaHelper } from "./helper.js";
`;

// vi.mock() in a test file leaves what a preload loaded with the mock of the preload. Hoisted, without a factory: fixed-runs/closed/automock-over-the-mock-of-a-preload.txt. This one is right as one program alone, so it cannot stand in a project that also runs over layers.
test("vi.mock() in a test, behind the imports", async () => {
  using dir = tempDir("aot-mock-over-preload", {
    "package.json": `{ "type": "module" }`,
    "bunfig.toml": `[test]\npreload = ["./preload.js"]\n`,
    "dep.js": `export const who = "real";\n`,
    "helper.js": `import { who } from "./dep.js";\nexport const viaHelper = () => who;\n`,
    "user.js": `import { who } from "./dep.js";\nexport const viaUser = () => who;\n`,
    "preload.js": `import { vi } from "bun:test";
import { viaHelper } from "./helper.js";
vi.mock("./dep.js", () => ({ who: "preload" }));
globalThis.heldByPreload = viaHelper;
`,
    "a.test.js": `import { test, vi } from "bun:test";
${imports}test("t", () => {
  vi.mock("./dep.js", () => ({ who: "file" }));
  console.log("seen:", dep.who, viaUser(), viaHelper(), heldByPreload());
});
`,
    "b.test.js": `import { test } from "bun:test";
${imports}test("t", () => console.log("seen:", dep.who, viaUser(), viaHelper(), heldByPreload()));
`,
  });
  const seenWith = async (...more: string[]) => {
    const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...more], String(dir), bunEnv);
    return {
      lines: stdout.split("\n").filter(line => line.startsWith("seen: ")),
      failed: stderr.split("\n").filter(line => /^\(fail\)|^✗|^panic|^error: /.test(line)),
      exitCode,
    };
  };
  const [plain, compiled] = await Promise.all([seenWith(), seenWith("--aot")]);
  expect(plain.lines).toHaveLength(2);
  expect(plain.exitCode).toBe(0);
  expect(compiled).toEqual(plain);
}, 180_000);
