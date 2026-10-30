import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const program = {
  "package.json": `{ "type": "module" }`,
  "lib.js": `export function f() { return "real"; }\nexport const v = "real v";`,
  "user.js": `import { f, v } from "./lib.js";\nexport const use = () => f() + " " + v;`,
};
const uses = `test("uses the mock", async () => { const { use } = await import("./user.js"); console.log(use()); });`;
const made = (word: string) => `() => ({ f: () => "${word}", v: "${word} v" })`;

// The build opens the modules that the test files mock. It reads that off calls written as `mock.module(..)`.
const forms: Record<string, string> = {
  "under another name": `import { mock, test } from "bun:test";\nconst other = mock;\nother.module("./lib.js", ${made("renamed")});\n${uses}`,
  "taken off mock": `import { mock, test } from "bun:test";\nconst { module: replace } = mock;\nreplace("./lib.js", ${made("taken off")});\n${uses}`,
  "kept as a value": `import { mock, test } from "bun:test";\nconst replace = mock.module;\nreplace("./lib.js", ${made("kept")});\n${uses}`,
  "under a computed key": `import { mock, test } from "bun:test";\nmock[["mod", "ule"].join("")]("./lib.js", ${made("computed")});\n${uses}`,
  "off the namespace object": `import * as runner from "bun:test";\nconst { test } = runner;\nrunner.mock.module("./lib.js", ${made("namespace")});\n${uses}`,
  "off jest under another name": `import { jest, test } from "bun:test";\nconst other = jest;\nother.mock("./lib.js", ${made("jest")});\n${uses}`,
  "off what Bun.jest answers": `import { test } from "bun:test";\nBun.jest(import.meta.path).mock.module("./lib.js", ${made("Bun.jest")});\n${uses}`,
  "handed to a function": `import { mock, test } from "bun:test";\nfunction replaceWith(tool) { tool.module("./lib.js", ${made("handed")}); }\nreplaceWith(mock);\n${uses}`,
};

for (const [name, text] of Object.entries(forms)) {
  test(`mock.module ${name} replaces a compiled module`, async () => {
    using dir = tempDir("a-mock-that-goes-somewhere-as-a-value", { ...program, "one.test.js": text });
    const runTests = async (...flags: string[]) => {
      const { stdout, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      return { stdout, exitCode };
    };
    const plain = await runTests();
    expect(plain.exitCode).toBe(0);
    expect(plain.stdout).not.toContain("real");
    expect(await runTests("--aot")).toEqual(plain);
  });
}

// The build opens the exports that spies replace. A spy that it cannot follow to its call counts for nothing, so the file has to say that it has one.
test("a spy got from Bun.jest replaces an export of a compiled module", async () => {
  using dir = tempDir("a-spy-got-from-bun-jest", {
    ...program,
    "one.test.js": `
      import { test } from "bun:test";
      import * as lib from "./lib.js";
      import { use } from "./user.js";
      const spy = Bun.jest(import.meta.path).spyOn;
      test("spies", () => { spy(lib, "f").mockImplementation(() => "spied"); console.log(use()); });`,
  });
  const runTests = async (...flags: string[]) => {
    const { stdout, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
    return { stdout, exitCode };
  };
  const plain = await runTests();
  expect(plain.exitCode).toBe(0);
  expect(plain.stdout).toContain("spied real v");
  expect(await runTests("--aot")).toEqual(plain);
});
