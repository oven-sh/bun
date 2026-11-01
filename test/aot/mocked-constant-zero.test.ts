import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A read of `const zero = 0` is lowered as the integer 0, also where the name is imported. A mock of the module, or of a file that hands the name on, says what the read gives.
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "dep.js": `console.log("SEEN runs dep"); export const zero = 0; export const seven = 7; export const own = () => zero;\n`,
  "barrel.js": `console.log("SEEN runs barrel"); export * from "./dep.js";\n`,
  "user.js": `console.log("SEEN runs user"); import { zero, seven } from "./dep.js"; export const atTheTop = zero; export const read = () => [zero, seven].join();\n`,
  "through.js": `console.log("SEEN runs through"); import { zero } from "./barrel.js"; export const read = () => zero;\n`,
  "ahead.test.js": `import { test, mock } from "bun:test";
mock.module("./dep.js", () => ({ zero: 1, seven: 8 }));
test("a mock ahead of the load", async () => { const user = await import("./user.js"); console.log("SEEN ahead", user.atTheTop, user.read()); });
`,
  "hoisted.test.js": `import { test, vi } from "bun:test";
import { read } from "./user.js";
import { zero } from "./dep.js";
vi.mock("./dep.js", () => ({ zero: 1, seven: 8 }));
test("a hoisted mock", () => console.log("SEEN hoisted", read(), zero));
`,
  "laid-over.test.js": `import { test, mock } from "bun:test";
import { read } from "./user.js";
import { own } from "./dep.js";
test("a mock laid over a loaded module", () => { console.log("SEEN before", read(), own()); mock.module("./dep.js", () => ({ zero: 1, seven: 8, own })); console.log("SEEN behind", read(), own()); });
`,
  "handed-on.test.js": `import { test, vi } from "bun:test";
import { read } from "./through.js";
vi.mock("./barrel.js", () => ({ zero: 1 }));
test("a mock of the file that hands the name on", () => console.log("SEEN handed on", read()));
`,
  "none.test.js": `import { test } from "bun:test";
import { read } from "./user.js";
test("no mock", () => console.log("SEEN none", read()));
`,
};

test.each(["ahead", "hoisted", "laid-over", "handed-on", "none"])(
  "%s: as plain Bun, as one program and in two layers",
  async name => {
    using dir = tempDir("aot-mocked-constant-zero", files);
    const seen = async (flags: string[], words: string) => {
      const { stdout, stderr } = await run([bunExe(), "test", ...flags, `./${name}.test.js`], String(dir), { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words }); // prettier-ignore
      return (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN"));
    };
    const plain = await seen([], "");
    expect(plain.length).toBeGreaterThan(1);
    expect(await seen(["--aot"], "TestRunLayers:0")).toEqual(plain);
    expect(await seen(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
  },
  600000,
);
