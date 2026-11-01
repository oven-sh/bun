import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// The factory of a mock imports the module that it mocks, and fails. That import comes to the mock behind the end of the run: `bun test` lets it share what became of the run
// and calls the factory once; compiled code called it again. Where the program also holds an import() of a name that nobody knows, the import goes through the engine's loader,
// and the second throw left the record linked with a rejected promise for good: "ASSERTION FAILED: module->status() == Status::Evaluated", and the old error for every later import.
const failures = {
  throws: `throw new Error("the factory failed " + calls);`,
  rejects: `return Promise.reject(new Error("the factory failed " + calls));`,
  "returns no object": `return 1;`,
};
const loaders = {
  "require()": [``, `require("./user.js")`],
  "import()": [``, `await import("./user.js")`],
  "require() of a computed name": [
    `const loaders = [async path => require(path), path => import(path)];`,
    `await loaders[0]("./user.js")`,
  ],
  "import() of a computed name": [
    `const loaders = [async path => require(path), path => import(path)];`,
    `await loaders[1]("./user.js")`,
  ],
};
const files = (head: string, load: string, fail: string) => ({
  "m.js": `import "./m.js"; export const b = 1;`,
  "user.js": `import "./m.js"; export const a = 1;`,
  "fails.test.js": `
    import { mock, test, vi } from "bun:test";
    ${head}
    test("t", async () => {
      vi.resetModules();
      let calls = 0;
      const imports = [];
      mock.module("./m.js", () => { calls++; imports.push(import("./m.js").then(ns => "got " + Object.keys(ns), e => "caught " + e.message)); ${fail} });
      try { const user = ${load}; console.log("loaded", Object.keys(user).join()); } catch (e) { console.log("threw", e.message); }
      console.log(JSON.stringify(await Promise.all(imports)), "calls", calls);
      try { await import("./m.js"); console.log("loaded again"); } catch (e) { console.log("again threw", e.message, "calls", calls); }
    });`,
});

async function runTests(folder: string, flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "."], folder, {
    ...bunEnv,
    NO_COLOR: "1",
  });
  return { printed: stdout.replace(/^bun test .*\n/, ""), counts: stderr.match(/^ \d+ (pass|fail)$/gm), exitCode };
}

test.each(
  Object.entries(loaders).flatMap(([loader, [head, load]]) =>
    Object.entries(failures).map(([how, fail]) => [loader, how, head, load, fail]),
  ),
)(
  "%s, the factory %s",
  async (_, how, head, load, fail) => {
    using dir = tempDir("factory-imports-own-module", files(head, load, fail));
    const plain = await runTests(String(dir), []);
    expect(plain).toMatchObject({ counts: [" 1 pass", " 0 fail"], exitCode: 0 });
    expect(plain.printed).toContain("calls 1\n");
    expect(await runTests(String(dir), ["--aot"])).toEqual(plain);
  },
  240_000,
);
