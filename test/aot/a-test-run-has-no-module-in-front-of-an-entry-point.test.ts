import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(240_000);

// `bun run` loads the entry point as the one import of the module "bun:main". A test run has no entry point, so `bun test` knows the name and has no such module: whoever loads it
// gets an error, and a test file that imports it fails. An executable has a module of that name, which does nothing.
const asks = (file: string) => `
import { test } from "bun:test";
import { createRequire } from "node:module";
const said = [];
const ask = async (label, load) => {
  try { said.push(label + ": " + (await load())); }
  catch (error) { said.push(label + " throws " + error?.constructor?.name + ": " + String(error?.message).split("\\n")[0]); }
};
const made = createRequire(import.meta.url);
const later = name => name + (process.argv.length > 90 ? "x" : "");
test("${file}", async () => {
  await ask("require", () => typeof require("bun:main"));
  await ask("require.resolve", () => require.resolve("bun:main"));
  await ask("import.meta.resolve", () => import.meta.resolve("bun:main"));
  await ask("import.meta.require", () => typeof import.meta.require("bun:main"));
  await ask("import()", async () => typeof (await import("bun:main")));
  await ask("createRequire", () => typeof made("bun:main"));
  await ask("createRequire resolve", () => made.resolve("bun:main"));
  await ask("computed require", () => typeof require(later("bun:main")));
  await ask("computed require.resolve", () => require.resolve(later("bun:main")));
  await ask("computed import()", async () => typeof (await import(later("bun:main"))));
  await ask("computed import.meta.resolve", () => import.meta.resolve(later("bun:main")));
  await ask("another module of the library", () => typeof require(later("bun:jsc")).gcAndSweep);
  console.log(said.map(line => "SAID ${file} " + line).join("\\n"));
});
`;
const passes = `import { test } from "bun:test";\ntest("passes", () => { console.log("SAID it runs"); });\n`;
const projects: Record<string, Record<string, string>> = {
  "code asks for it": { "a.test.js": asks("a"), "b.test.js": asks("b") },
  "a test file imports it": {
    "a.test.js": `import * as all from "bun:main";\nimport { test } from "bun:test";\ntest("t", () => { console.log("SAID", typeof all); });\n`,
    "b.test.js": passes,
  },
};
const forms: Record<string, string | undefined> = {
  "by itself": undefined,
  "as one program": "TestRunLayers:0",
  "over layers": "TestRunLayers:2,TestRunPartFiles:1",
};

for (const [name, files] of Object.entries(projects)) {
  test.concurrent(`"bun:main" in a test run: ${name}`, async () => {
    using dir = tempDir("no-module-in-front-of-an-entry-point", {
      "package.json": `{ "name": "p", "type": "module" }`,
      "tsconfig.json": "{}",
      ...files,
    });
    const answer = async (env: Record<string, string | undefined>, ...flags: string[]) => {
      const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], String(dir), env);
      const lines = (stdout + "\n" + stderr).split("\n");
      const kept = lines.filter(line => /^SAID |^error: ENOENT|^ *\d+ (pass|fail|error)s?$/.test(line));
      return { lines: kept.map(line => line.trim()).sort(), exitCode };
    };
    const plain = await answer(bunEnv);
    expect(plain.lines.join("\n")).toContain('ENOENT reading "bun:main"');
    for (const [form, words] of Object.entries(forms))
      expect({ form, ...(await answer({ ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words }, "--aot")) }).toEqual({
        form,
        ...plain,
      });
  });
}

test.concurrent(`"bun:main" in an executable`, async () => {
  using dir = tempDir("module-in-front-of-an-entry-point", {
    "main.mjs": `
      const later = name => name + (process.argv.length > 90 ? "x" : "");
      setTimeout(async () => {
        console.log(import.meta.resolve("bun:main"), typeof (await import("bun:main")), typeof (await import(later("bun:main"))));
      }, 1);
    `,
  });
  const plain = await run([bunExe(), "run", "main.mjs"], String(dir), bunEnv);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({
    stdout: "bun:main object object\n",
    exitCode: 0,
  });
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "main.exe"],
    String(dir),
    bunEnv,
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  const compiled = await run([String(dir) + "/main.exe"], String(dir), bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
});
