import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// What a hook of a preload loads belongs to the preload, so `bun test` evicts it for no mock of a test file. Where a compiled run runs such a file again, or keeps it, it names one that is concerned.
const head = `import { afterEach, beforeAll, beforeEach, jest, mock, test, vi } from "bun:test";\nconst said = (globalThis.said ??= []);\nconst ask = async (file, load) => {\n  try {\n    const module = await load();\n    said.push(file + " " + (module.seen ? module.seen() : module.value));\n  } catch (error) {\n    said.push(file + " threw " + error.message.slice(0, 24));\n  }\n};\nconst tell = at => console.log("SAID", at, said.splice(0).join(", "));\n`;
const hooks = ["beforeEach", "beforeAll", "afterEach"];
const mocks = {
  "vi.doMock()": `vi.doMock("./dep.mjs", () => ({ value: "mock" }));`,
  "vi.doMock() of the original": `vi.doMock("./dep.mjs", async () => ({ ...(await vi.importActual("./dep.mjs")), value: "mock" }));`,
  "jest.doMock()": `jest.doMock("./dep.mjs", () => ({ value: "mock" }));`,
  "mock.module()": `mock.module("./dep.mjs", () => ({ value: "mock" }));`,
  "mock.module() of the original": `await mock.module("./dep.mjs", async () => ({ ...(await vi.importActual("./dep.mjs")), value: "mock" }));`,
};
const first = {
  "no file before": "",
  "a file that loads the user before": `test("a", async () => {\n  await ask("user", () => import("./user.mjs"));\n  tell("a");\n});\n`,
};
const saidIn = (text: string) => text.split("\n").filter(line => line.startsWith("SAID"));
const isNamed = (text: string) => /^ {2}(bar|user|dep)\.mjs(\?actual)?[:,] .*\bran$/m.test(text);

for (const hook of hooks) {
  for (const [what, call] of Object.entries(mocks)) {
    for (const [before, start] of Object.entries(first)) {
      test(`${hook}, ${what}, ${before}`, async () => {
        using dir = tempDir("aot-preload-hook", {
          "bunfig.toml": `[test]\npreload = ["./setup.mjs"]\n`,
          "setup.mjs": `${head}${hook}(async () => {\n  await ask("bar", () => import("./bar.mjs"));\n});\n`,
          "dep.mjs": `globalThis.runs = (globalThis.runs ?? 0) + 1;\nglobalThis.said?.push("run dep");\nexport const value = "real " + globalThis.runs;\n`,
          "user.mjs": `import { value } from "./dep.mjs";\nglobalThis.said?.push("run user");\nexport const seen = () => value;\n`,
          "bar.mjs": `export * from "./dep.mjs";\nexport { seen } from "./user.mjs";\nglobalThis.said?.push("run bar");\n`,
          "a.test.mjs": head + start,
          "b.test.mjs": `${head}test("b", async () => {\n  ${call}\n  await ask("bar", () => import("./bar.mjs"));\n  await ask("user", () => import("./user.mjs"));\n  tell("b");\n});\ntest("b again", async () => {\n  await ask("dep", () => import("./dep.mjs"));\n  tell("b again");\n});\n`,
          "c.test.mjs": `${head}test("c", async () => {\n  await ask("user", () => import("./user.mjs"));\n  await ask("dep", () => import("./dep.mjs"));\n  tell("c");\n});\n`,
        });
        const files = [...(start ? ["./a.test.mjs"] : []), "./b.test.mjs", "./c.test.mjs"];
        const [plain, compiled] = await Promise.all([
          run([bunExe(), "test", ...files], String(dir), bunEnv),
          run([bunExe(), "test", "--aot", ...files], String(dir), bunEnv),
        ]);
        expect(saidIn(plain.stdout).length).toBe(files.length + 1);
        expect(compiled.exitCode).toBe(plain.exitCode);
        if (!isNamed(compiled.stderr)) expect(saidIn(compiled.stdout)).toEqual(saidIn(plain.stdout));
      });
    }
  }
}
