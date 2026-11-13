import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// A reset under a mock of a data file: at the end of the mock `bun test` brings back the object that was loaded before both. A compiled run reads the file again, and says so.
const forms = {
  namespace: `import * as data from "./dep.json";\nexport const show = () => data.default.value;\nexport const object = () => data.default;\n`,
  default: `import data from "./dep.json";\nexport const show = () => data.value;\nexport const object = () => data;\n`,
};
const mocks = {
  "a mock": `vi.doMock("./dep.json", () => ({ default: { value: "mock" } }));`,
  "a mock that takes its original": `vi.doMock("./dep.json", async () => ({ ...(await vi.importActual("./dep.json")), value: "mock" }));`,
};
const load = `import { jest, test, vi } from "bun:test";\nconst seen = (globalThis.seen ??= []);\nconst load = async at => {\n  const user = await import("./user.mjs");\n  if (!seen.includes(user.object())) seen.push(user.object());\n  console.log("SAID", at, user.show());\n};\n`;
const named = (text: string) =>
  [...text.matchAll(/^ {2}(dep\.json): .*while (\S+) ran$/gm)].map(([, file, during]) => `${file} ${during}`);

for (const [form, user] of Object.entries(forms)) {
  for (const reset of ["vi", "jest"]) {
    for (const [what, call] of Object.entries(mocks)) {
      for (const resets of [true, false]) {
        test(`${what} over a data file, its ${form}, ${resets ? `${reset}.resetModules()` : `no reset (${reset})`}`, async () => {
          using dir = tempDir("aot-data-file-reset", {
            "dep.json": `{ "value": "json" }\n`,
            "user.mjs": user,
            "a.test.mjs": `${load}test("a", async () => {\n  await load("first");\n  ${call}\n  ${resets ? `${reset}.resetModules();` : ""}\n  await load("second");\n});\n`,
            "b.test.mjs": `${load}test("b", () => load("third"));\n`,
          });
          const files = ["./a.test.mjs", "./b.test.mjs"];
          const [plain, compiled] = await Promise.all([
            run([bunExe(), "test", ...files], String(dir), bunEnv),
            run([bunExe(), "test", "--aot", ...files], String(dir), bunEnv),
          ]);
          const said = (text: string) => text.split("\n").filter(line => line.startsWith("SAID"));
          expect({ said: said(compiled.stdout), exitCode: compiled.exitCode, named: named(compiled.stderr) }).toEqual({
            said: said(plain.stdout),
            exitCode: plain.exitCode,
            named: resets ? ["dep.json b.test.mjs"] : [],
          });
        });
      }
    }
  }
}
