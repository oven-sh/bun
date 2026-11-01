import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// l imports k, k imports j, j imports i. With a mock in place of k, the load of l never comes to j and i: `bun test` does not fetch them. A program has linked them all the
// same. A mock of such a module waits for its first load, as the mock of any module that has not loaded, and ends with vi.doUnmock() and with its test file.
const say = `function say(text) { (globalThis.said ??= []).push(text); }\n`;
const head = `import { test, vi } from "bun:test";\n` + say;
const end = (body: string) =>
  `test("t", async () => {\n${body}  console.log("SAID", globalThis.said.join(" | ")); globalThis.said = [];\n});\n`;
const modules = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "l.js": `import { x } from "./k.js";\nexport const top = () => x;\n`,
  "k.js": `${say}import { y } from "./j.js";\nsay("k runs");\nexport const x = "real-k:" + y;\n`,
  "j.js": `${say}import { z } from "./i.js";\nsay("j runs");\nexport const y = "real-j:" + z;\n`,
  "i.js": `${say}say("i runs");\nexport const z = "real-i";\n`,
};
const mocksBoth = `  vi.doMock("./k.js", () => { say("factory k"); return { x: "mock-k" }; });\n  await import("./l.js");\n  vi.doMock("./j.js", () => { say("factory j"); return { y: "mock-j" }; });\n  say("mocked");\n`;
const first =
  head + end(`${mocksBoth}  say("a: " + (await import("./l.js")).top() + " " + (await import("./j.js")).y);\n`);
const second =
  head + end(`  vi.doMock("./i.js", () => ({ z: "mock-i" }));\n  say("b: " + (await import("./j.js")).y);\n`);

const projects: Record<string, Record<string, string>> = {
  "it ends with vi.doUnmock()": {
    "a.test.js":
      head +
      end(
        `${mocksBoth}  say("first: " + (await import("./j.js")).y);\n  vi.doUnmock("./j.js");\n  vi.doMock("./i.js", () => ({ z: "mock-i" }));\n  say("then: " + (await import("./j.js")).y);\n`,
      ),
  },
  "it ends with its test file": {
    "a.test.js": first,
    "c.test.js":
      head +
      end(
        `  say("c: " + (await import("./l.js")).top() + " " + (await import("./j.js")).y + " " + (await import("./i.js")).z);\n`,
      ),
  },
  "so does the mock that the next file lays below it": {
    "a.test.js": first,
    "b.test.js": second,
    "c.test.js": head + end(`  say("c: " + (await import("./i.js")).z);\n`),
  },
};

const seen = async (dir: string, words?: string) => {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, exitCode } = await run([bunExe(), "test", ...(words ? ["--aot"] : [])], dir, env);
  return { exitCode, said: stdout.split("\n").filter(line => line.startsWith("SAID ")) };
};

for (const [name, files] of Object.entries(projects)) {
  test(name, async () => {
    using dir = tempDir("mock-below-mock", { ...modules, ...files });
    const plain = await seen(String(dir));
    expect(plain.exitCode).toBe(0);
    expect(plain.said.length).toBe(Object.keys(files).length);
    expect(await seen(String(dir), "TestRunLayers:0")).toEqual(plain);
    expect(await seen(String(dir), "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
  });
}
