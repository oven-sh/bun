import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test as oneAtATime } from "./supported";

raiseDefaultTimeout(120_000);

const test = oneAtATime.concurrent;

// The path of the import() is written out and its type is made at run time. Once the file has been taken out, it is loaded again by that type.

const files = {
  "package.json": `{ "name": "box", "private": true }`,
  "a.ts": `globalThis.ran = (globalThis.ran ?? 0) + 1;\nconsole.log("a.ts runs");\nexport default "code";\n`,
  "box.json": `{ "name": "box" }\n`,
  "crate.toml": `lid = "oak"\n`,
};

const load = (path: string, kind = "text") => `import("./${path}", { with: { type: ${kind} } })`;
const show = (call: string) => `show(await ${call});`;
const reset = `vi.resetModules();`;

const cases: Record<string, string[]> = {
  "a JSON file": [show(load("box.json")), reset, show(load("box.json")), show(load("box.json"))],
  "a file of code": [show(load("a.ts")), reset, show(load("a.ts")), show(`import("./a.ts")`)],
  "a file whose key is deleted": [
    show(load("box.json")),
    `delete require.cache[require.resolve("./box.json")];`,
    show(load("box.json")),
  ],
  "another type behind it": [
    show(load("box.json")),
    reset,
    show(load("box.json", "json")),
    show(`import("./box.json")`),
    show(load("box.json")),
  ],
  "a call that the reset overtakes": [
    show(load("box.json")),
    `const imported = ${load("box.json")};`,
    reset,
    `show(await imported);`,
    show(load("box.json")),
  ],
  "the type that the file has anyway, and a require behind it": [
    show(load("crate.toml", "toml")),
    `delete require.cache[require.resolve("./crate.toml")];`,
    show(load("crate.toml", "toml")),
    `show(require("./crate.toml"));`,
    show(load("crate.toml", "toml")),
  ],
  "without a reset": [show(load("box.json")), show(load("box.json")), show(`import("./box.json")`)],
  "JSON of a JSON file": [show(load("box.json", "json")), reset, show(load("box.json", "json"))],
};

for (const [name, steps] of Object.entries(cases)) {
  test(name, async () => {
    const test = async (...flags: string[]) => {
      // A build leaves files beside what it reads.
      using dir = tempDir("made-type", {
        ...files,
        "a.test.ts": `
          import { test, vi } from "bun:test";
          const text = globalThis.never ?? "text";
          const json = globalThis.never ?? "json";
          const toml = globalThis.never ?? "toml";
          const show = space => console.log(typeof space.default, JSON.stringify(space.default), "ran", globalThis.ran ?? 0);
          test("a", async () => {
            ${steps.join("\n            ")}
          });`,
      });
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], String(dir), bunEnv);
      const passed = [...stderr.matchAll(/^\(pass\) (.*?)(?: \[.*\])?$/gm)].map(match => match[1]);
      return { stdout, passed, stderr: exitCode ? stderr : "", exitCode };
    };
    const plain = await test();
    expect({ passed: plain.passed, exitCode: plain.exitCode }).toEqual({ passed: ["a"], exitCode: 0 });
    expect(await test("--aot")).toEqual(plain);
  });
}
