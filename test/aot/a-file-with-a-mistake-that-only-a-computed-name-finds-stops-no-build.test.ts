import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// An executable holds whatever `import(name)` may find, and a project is full of files that nobody ever loads: the tsconfig with comments that a package ships as
// `base.json`, a fixture with a syntax error. `bun run` says what is wrong with such a file where the program loads it. The build once stopped at each of them.
// The executable holds such a file as it is, and says the same as `bun run`, in the words of the loader of its kind. It once said "Cannot find module".
const mistakes = {
  "node_modules/pkg/configs/base.json": `{\n  // a comment\n  "a": 1\n}\n`,
  "node_modules/pkg/fixtures/broken.js": `const a = ;\n`,
  "data/commented.json": `{\n  // a comment\n  "a": 2\n}\n`,
  "data/broken.js": `const b = ;\n`,
  "data/broken.ts": `const c: = 1;\n`,
  "data/broken.toml": `a = [\n`,
};
const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "node_modules/pkg/package.json": `{ "name": "pkg", "version": "1.0.0", "exports": { ".": "./index.js", "./configs/*": "./configs/*.json" } }`,
  "node_modules/pkg/index.js": `module.exports = { name: "pkg" };\n`,
  "data/good.json": `{ "a": 3 }\n`,
  "data/good.js": `export default "good";\n`,
  ...mistakes,
  "main.js": `const tried = async (label, load) => {
  try {
    console.log(label, JSON.stringify((await load()).default));
  } catch (error) {
    console.log(label, "threw", error.constructor.name + ":", String(error.message).split("\\n")[0]);
  }
};
const unknown = process.argv[2] ?? "node:path";
await tried("a name nobody knows", async () => ({ default: typeof (await import(unknown)).join }));
await tried("required", async () => ({ default: typeof require(unknown).join }));
for (const name of ["good.json", "good.js", "commented.json", "broken.js", "broken.ts", "broken.toml"]) {
  await tried(name, () => import("./data/" + name));
  await tried(name + " once more", () => import("./data/" + name));
  await tried(name + " required", async () => ({ default: typeof require("./data/" + name) }));
}
for (const name of ["base"]) {
  await tried("of a package", () => import("pkg/configs/" + name));
  await tried("of a package, required", async () => ({ default: typeof require("pkg/configs/" + name) }));
}
`,
  "spelled.js": `import data from "./data/commented.json";\nconsole.log(data);\n`,
};

test("the program builds, and runs as under bun run", async () => {
  using dir = tempDir("aot-mistake-behind-a-computed-name", files);
  const cwd = String(dir);
  const plain = await run([bunExe(), "main.js"], cwd, bunEnv);
  expect(plain.stdout.split("\n")).toEqual([
    `a name nobody knows "function"`,
    `required "function"`,
    `good.json {"a":3}`,
    `good.json once more {"a":3}`,
    `good.json required "object"`,
    `good.js "good"`,
    `good.js once more "good"`,
    `good.js required "object"`,
    ...["commented.json", "commented.json once more", "commented.json required"].map(
      label => label + " threw SyntaxError: JSON Parse error: Unrecognized token '/'",
    ),
    ...["broken.js", "broken.js once more", "broken.js required"].map(
      label => label + " threw BuildMessage: Unexpected ;",
    ),
    ...["broken.ts", "broken.ts once more", "broken.ts required"].map(
      label => label + " threw BuildMessage: Unexpected =",
    ),
    ...["broken.toml", "broken.toml once more", "broken.toml required"].map(
      label => label + " threw BuildMessage: Unterminated array; expected ']'",
    ),
    "of a package threw SyntaxError: JSON Parse error: Unrecognized token '/'",
    "of a package, required threw SyntaxError: JSON Parse error: Unrecognized token '/'",
    "",
  ]);
  const executable = join(cwd, "main" + (isWindows ? ".exe" : ""));
  const build = await run([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable], cwd, bunEnv);
  expect({
    stderr: build.stderr.split("\n").filter(line => line.startsWith("error")),
    exitCode: build.exitCode,
  }).toEqual({
    stderr: [],
    exitCode: 0,
  });
  const compiled = await run([executable], cwd, bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}, 240_000);

test("a file with a mistake that a statement spells stops the build, as it stops bun build", async () => {
  using dir = tempDir("aot-mistake-behind-a-computed-name", files);
  const cwd = String(dir);
  const executable = join(cwd, "spelled" + (isWindows ? ".exe" : ""));
  const build = await run(
    [bunExe(), "build", "--compile", "--aot", "spelled.js", "--outfile", executable],
    cwd,
    bunEnv,
  );
  expect(build.exitCode).toBe(1);
  expect(build.stderr).toContain("JSON does not support comments");
  expect(build.stderr).toContain("commented.json");
}, 240_000);
