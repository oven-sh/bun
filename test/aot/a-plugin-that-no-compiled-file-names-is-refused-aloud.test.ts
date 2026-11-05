import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { compileCommand } from "./harness/flags";
import { run } from "./harness/run";
import { describe, test } from "./supported";

// The build links the imports of a program as if no plugin could answer for them, unless a file that it compiles names Bun.plugin. A program that came by the function some other way got the real
// module, in silence, where `bun main.mjs`, the plain executable and `bun test` get the plugin's. Bun.plugin() refuses such a call aloud.
const refusal = "Cannot use Bun.plugin: no file that was compiled names it";
const env = { ...bunEnv, NO_COLOR: "1" };
const options = String.raw`{ name: "swaps", setup(build) {
  build.onResolve({ filter: /a\.mjs$/ }, args => ({ path: args.path, namespace: "swapped" }));
  build.onLoad({ filter: /.*/, namespace: "swapped" }, args => ({ contents: "export default " + JSON.stringify("the plugin's " + args.path), loader: "js" }));
} }`;
const modules = {
  "a.mjs": `export default "the real a";`,
  "b.mjs": `export default "the real b";`,
  "use.mjs": `export const use = (bun, options) => bun.plugin(options);`,
  "package.json": `{ "name": "program", "type": "module" }`,
};
const loads = `const pick = process.argv.length > 5 ? "./b.mjs" : "./a.mjs";
console.log((await import(pick)).default);`;

async function answersOf(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("aot-a-plugin-that-no-compiled-file-names", files);
  const executable = join(String(dir), isWindows ? "program.exe" : "program");
  const plain = await run([bunExe(), "main.mjs"], String(dir), env);
  const built = await run(
    [bunExe(), ...compileCommand, ...flags, "main.mjs", "--outfile", executable],
    String(dir),
    env,
  );
  expect(built.exitCode).toBe(0);
  return { plain, compiled: await run([executable], String(dir), env) };
}

describe("an executable", () => {
  test.each([
    ["Bun is handed to a helper", `import { use } from "./use.mjs";\nuse(Bun, ${options});`],
    ["by a key that is made", `Bun[["plu", "gin"].join("")](${options});`],
    ["off the global object by a key that is made", `globalThis[["B", "un"].join("")].plugin(${options});`],
  ])("%s", async (_, registers) => {
    const { plain, compiled } = await answersOf({ ...modules, "main.mjs": registers + "\n" + loads });
    expect(plain.stdout).toBe("the plugin's ./a.mjs\n");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: "", exitCode: 1 });
    expect(compiled.stderr).toContain(refusal);
  });

  test("named in sight, the plugin answers", async () => {
    const { plain, compiled } = await answersOf({ ...modules, "main.mjs": `Bun.plugin(${options});\n` + loads });
    expect(plain.stdout).toBe("the plugin's ./a.mjs\n");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });

  test("where code may come from disk, a file from disk registers a plugin for what it loads itself", async () => {
    const files = {
      "package.json": modules["package.json"],
      "main.mjs": `await import(process.cwd() + "/" + JSON.parse('"late"') + ".mjs");`,
      "late.mjs": `Bun.plugin({ name: "makes", setup(build) { build.module("made:up", () => ({ exports: { default: "made up" }, loader: "object" })); } });
console.log((await import("made:up")).default);`,
    };
    const { plain, compiled } = await answersOf(files, "--aot-allow-code-from-disk");
    expect(plain.stdout).toBe("made up\n");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});

describe("a test run", () => {
  test.each([
    [
      "Bun is handed to a helper",
      {
        ...modules,
        "a.test.js": `import { test } from "bun:test";
import { use } from "./use.mjs";
test("registers", async () => {
  use(Bun, ${options});
  console.log("SAID", (await import("./a.mjs")).default);
});`,
      },
    ],
    [
      "a file that is loaded from disk registers it",
      {
        ...modules,
        "register.cjs": `Bun.plugin(${options});`,
        "a.test.js": `import { test } from "bun:test";
test("registers", async () => {
  require(JSON.parse('"./register.cjs"'));
  console.log("SAID", (await import("./a.mjs")).default);
});`,
      },
    ],
  ])("%s", async (_, files) => {
    using dir = tempDir("aot-a-plugin-that-no-compiled-file-names", files);
    const plain = await run([bunExe(), "test", "./a.test.js"], String(dir), env);
    expect(plain.stdout).toContain("SAID the plugin's ./a.mjs");
    const compiled = await run([bunExe(), "test", "--aot", "./a.test.js"], String(dir), env);
    expect(compiled.stdout).not.toContain("SAID");
    expect(compiled.stderr).toContain(refusal);
    expect(compiled.exitCode).toBe(1);
  });
});
