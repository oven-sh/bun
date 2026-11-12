import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// `bun test` keeps the barrel of the first test file and runs the CommonJS file when it is next requested. If the static import of a compiled run runs the file earlier, a notice names the file.
const head = `import { jest, mock, test, vi } from "bun:test";\nimport { flag } from "./star.js";\nimport * as all from "./star.js";\nconst say = (...words) => console.log("SAID", ...words);\n`;
const seconds = {
  "mock.module()": `mock.module("./dep.cjs", () => ({ flag: "second", plain: "second" }));`,
  "jest.mock()": `jest.mock("./dep.cjs", () => ({ flag: "second", plain: "second" }));`,
};
const firsts = {
  "vi.doMock()": `vi.doMock("./dep.cjs", () => ({ flag: "first", plain: "first" }));`,
  "vi.doMock() of the original": `vi.doMock("./dep.cjs", async original => ({ ...(await original()), flag: "first" }));`,
};
const saidIn = (text: string) => text.split("\n").filter(line => line.startsWith("SAID"));
const isNamed = (text: string) => /^ {2}(dep\.cjs|star\.js)(\?actual)?[:,] .*\bran$/m.test(text);

for (const [first, firstCall] of Object.entries(firsts)) {
  for (const [second, secondCall] of Object.entries(seconds)) {
    test(`${first}, ${second}`, async () => {
      const use = `say("import", (await import("./dep.cjs")).flag);\n  say("require", import.meta.require("./dep.cjs").flag);`;
      using dir = tempDir("aot-name-behind-star", {
        "package.json": `{ "type": "module" }\n`,
        "dep.cjs": `console.log("SAID run dep");\nglobalThis.runs = (globalThis.runs ?? 0) + 1;\nexports.flag = "real " + globalThis.runs;\nexports.plain = "real";\n`,
        "star.js": `export * from "./dep.cjs";\n`,
        "a.test.js": `${head}test("a", async () => {\n  ${use}\n  ${firstCall}\n  ${secondCall}\n  ${use}\n  say(flag, all.flag);\n});\n`,
        "b.test.js": `${head}test("b", async () => {\n  say("b", flag, all.flag);\n  ${use}\n  say(flag, all.flag);\n});\n`,
      });
      const files = ["./a.test.js", "./b.test.js"];
      const [plain, compiled] = await Promise.all([
        run([bunExe(), "test", ...files], String(dir), bunEnv),
        run([bunExe(), "test", "--aot", ...files], String(dir), bunEnv),
      ]);
      expect(saidIn(plain.stdout).length).toBeGreaterThan(8);
      expect(compiled.exitCode).toBe(plain.exitCode);
      if (!isNamed(compiled.stderr)) expect(saidIn(compiled.stdout)).toEqual(saidIn(plain.stdout));
    });
  }
}
