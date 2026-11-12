import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// In `bun test` a require() that comes while a later mock of a patched file waits for its original gets that original, or is refused. Where a compiled run answers the earlier mock, it names the file.
const head = `import { jest, mock, test, vi } from "bun:test";\nimport { createRequire } from "node:module";\nconst require = createRequire(import.meta.url);\nconst said = (globalThis.said ??= []);\nconst ask = async (name, load) => {\n  try {\n    const module = await load();\n    said.push(name + " " + (module.seen ? module.seen() : module.value));\n  } catch (error) {\n    said.push(name + " threw " + error.message.slice(0, 24));\n  }\n};\nconst tell = at => console.log("SAID", at, said.splice(0).join(", "));\n`;
const calls = { "mock.module()": "mock.module", "jest.doMock()": "jest.doMock" };
const originals = {
  "vi.importActual()": `async () => ({ ...(await vi.importActual("./dep.mjs")), value: "second" })`,
  "its parameter": `async original => ({ ...(await original()), value: "second" })`,
};
const shapes = {
  "a CommonJS file, behind an import and a require()": [
    `await ask("user", () => import("./user.mjs"));`,
    `await ask("required", () => require("./dep.mjs"));`,
    `await ask("requirer", () => require("./requirer.cjs"));`,
  ],
  "the test file, behind an import of the mock": [
    "",
    `await ask("dep", () => import("./dep.mjs"));`,
    `await ask("required", () => require("./dep.mjs"));`,
  ],
};
const saidIn = (text: string) => text.split("\n").filter(line => line.startsWith("SAID"));
const isNamed = (text: string) => /^ {2}(dep\.mjs|requirer\.cjs|user\.mjs)(\?actual)?[:,] .*\bran$/m.test(text);

for (const [kind, call] of Object.entries(calls)) {
  for (const [way, factory] of Object.entries(originals)) {
    for (const [shape, [front, first, second]] of Object.entries(shapes)) {
      test(`${kind}, ${way}, ${shape}`, async () => {
        using dir = tempDir("aot-pending-patch", {
          "dep.mjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;\nglobalThis.said?.push("run dep");\nexport const value = "real " + globalThis.runs;\n`,
          "user.mjs": `import { value } from "./dep.mjs";\nglobalThis.said?.push("run user");\nexport const seen = () => value;\n`,
          "requirer.cjs": `globalThis.said?.push("run requirer");\nconst dep = require("./dep.mjs");\nexports.seen = () => dep.value;\n`,
          "a.test.mjs": `${head}test("a", async () => {\n  ${front}\n  ${call}("./dep.mjs", () => ({ value: "first" }));\n  ${first}\n  void ${call}("./dep.mjs", ${factory});\n  ${second}\n  await ask("user", () => import("./user.mjs"));\n  tell("a");\n});\n`,
          "b.test.mjs": `${head}test("b", async () => {\n  await ask("user", () => import("./user.mjs"));\n  await ask("requirer", () => require("./requirer.cjs"));\n  tell("b");\n});\n`,
        });
        const files = ["./a.test.mjs", "./b.test.mjs"];
        const [plain, compiled] = await Promise.all([
          run([bunExe(), "test", ...files], String(dir), bunEnv),
          run([bunExe(), "test", "--aot", ...files], String(dir), bunEnv),
        ]);
        expect(saidIn(plain.stdout).length).toBe(files.length);
        expect(compiled.exitCode).toBe(plain.exitCode);
        if (!isNamed(compiled.stderr)) expect(saidIn(compiled.stdout)).toEqual(saidIn(plain.stdout));
      });
    }
  }
}
