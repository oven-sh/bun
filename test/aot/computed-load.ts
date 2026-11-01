// For ./computed-load-<part>.test.ts: one process took too much of what CI gives a file.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join, resolve } from "node:path";
import { afterAll } from "./harness/default-timeout";
import { run } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

export function computedLoads(part: number) {
  // A product that loads a plug-in from disk under a name it computes throws in an executable built without --aot-allow-code-from-disk.
  // A test run that let it load the plug-in would be green for a program that fails once it is built.
  const refusal = `error => "REFUSED " + error.message.split(": ")[1]?.split(",")[0] + (error.message.includes("--aot-allow-code-from-disk") ? ", and names the flag" : "")`;
  const files = {
    "package.json": `{ "name": "product" }`,
    "src/loads.cjs": `exports.load = name => { try { return require(name); } catch (error) { return (${refusal})(error); } };`,
    "src/imports.mjs": `export const load = path => import(path).then(it => it.default, ${refusal});`,
    "plugins/one.cjs": `module.exports = "a CommonJS plug-in";`,
    "plugins/one.mjs": `export default "an ES plug-in";`,
    // What a file of the tests has loaded is in the loader's registry from then on, so each of them loads a file of its own.
    "plugins/two.mjs": `export default "the helper's";`,
    "plugins/three.mjs": `export default "the preload's";`,
    "plugins/four.mjs": `export default "the stub's";`,
    "main.mjs": `
    import { createRequire } from "node:module";
    import { load as imports } from "./src/imports.mjs";
    const { load } = createRequire(import.meta.url)("./src/loads.cjs");
    console.log("SAID require:", load(process.cwd() + "/plugins/one.cjs"));
    console.log("SAID import:", await imports(process.cwd() + "/plugins/one.mjs"));`,
    "test/helper.mjs": `export const load = path => import(path).then(it => it.default);`,
    // It lies among the sources, and no executable holds it: it takes something from the test runner.
    "src/testing/stubs.mjs": `import { mock } from "bun:test";\nexport const load = mock(path => import(path).then(it => it.default));`,
    // It lies in no folder of a test file.
    "setup/preload.mjs": `globalThis.preloaded = (await import(process.cwd() + "/plugins/" + ["three", "mjs"].join("."))).default;`,
    "test/product.test.mjs": `
    import { test } from "bun:test";
    import { createRequire } from "node:module";
    import { rmSync, writeFileSync } from "node:fs";
    import { load as imports } from "../src/imports.mjs";
    import { load as stubs } from "../src/testing/stubs.mjs";
    import { load as helps } from "./helper.mjs";
    const { load } = createRequire(import.meta.url)("../src/loads.cjs");
    test("the product", async () => {
      console.log("SAID require:", load(process.cwd() + "/plugins/one.cjs"));
      console.log("SAID import:", await imports(process.cwd() + "/plugins/one.mjs"));
    });
    test("the test itself and its helper", async () => {
      const made = import.meta.dir + "/made.mjs";
      writeFileSync(made, "export default 42;");
      console.log("SAID the test:", (await import(made)).default);
      console.log("SAID its helper:", await helps(process.cwd() + "/plugins/two.mjs"));
      console.log("SAID the preload:", globalThis.preloaded);
      console.log("SAID a stub among the sources:", await stubs(process.cwd() + "/plugins/four.mjs"));
      rmSync(made);
    });`,
  };

  // With what the runner lists when the run ends: a program may catch a refusal and say nothing.
  const said = (output: string) =>
    output
      .split("\n")
      .filter(line => /^SAID |^\d+ loads? of code|^\d+ native addons? |^  (Cannot load|Loaded) /.test(line))
      .map(line =>
        line
          .replace(/^  (?:Cannot load|Loaded) '.*\/((?:plugins|native)\/[^']+)', at ([^:]+):.*$/, "LISTED $1, at $2")
          .replace(/^(\d+ (?:loads? of code that wasn't compiled|native addons? that the build didn't find)).*$/, "$1"),
      );
  const loaded = ["SAID require: a CommonJS plug-in", "SAID import: an ES plug-in"];
  const ofTests = [
    "SAID the test: 42",
    "SAID its helper: the helper's",
    "SAID the preload: the preload's",
    "SAID a stub among the sources: the stub's",
  ];

  async function testRun(directory: string, flags: string[], words = "") {
    const { stdout, stderr } = await run([bunExe(), "test", "--preload", "./setup/preload.mjs", ...flags], directory, {
      ...bunEnv,
      NO_COLOR: "1",
      BUN_DEBUG_TEST_AOT_WORDS: words,
    });
    return said(stdout + "\n" + stderr);
  }

  async function executable(directory: string, ...flags: string[]) {
    const file = join(directory, `built${flags.length}${isWindows ? ".exe" : ""}`);
    const built = await run(
      [bunExe(), "build", "--compile", "--aot", ...flags, "./main.mjs", "--outfile", file],
      directory,
    );
    expect(built).toMatchObject({ exitCode: 0 });
    return said((await run([file], directory)).stdout);
  }

  if (part === 1)
    test("plain Bun loads the plug-ins, run and tested", async () => {
      using directory = tempDir("a-computed-load-of-the-product-plain", files);
      expect(said((await run([bunExe(), "run", "./main.mjs"], String(directory))).stdout)).toEqual(loaded);
      expect(await testRun(String(directory), [])).toEqual([...loaded, ...ofTests]);
    });

  const forms = [
    ["as one program", "TestRunLayers:0"],
    ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
    ["over three layers", "TestRunLayers:3,TestRunPartFiles:1"],
  ];

  if (part === 1)
    test("an executable refuses them", async () => {
      using directory = tempDir("a-computed-load-of-the-product", files);
      expect(await executable(String(directory))).toEqual([
        "SAID require: REFUSED it isn't in this executable, and names the flag",
        "SAID import: REFUSED it isn't in this executable, and names the flag",
      ]);
    });

  if (part === 1)
    test("with --aot-allow-code-from-disk an executable loads them", async () => {
      using directory = tempDir("a-computed-load-of-the-product-with-the-flag", files);
      expect(await executable(String(directory), "--aot-allow-code-from-disk")).toEqual(loaded);
    });

  for (const [form, words] of forms.filter((_, index) => index + 1 === part)) {
    test(`a test run ${form} answers the product as its executable does, and the tests as plain Bun does`, async () => {
      using directory = tempDir("a-computed-load-of-the-product", files);
      expect(await testRun(String(directory), ["--aot"], words)).toEqual([
        "SAID require: REFUSED it wasn't compiled with the program, and names the flag",
        "SAID import: REFUSED it wasn't compiled with the program, and names the flag",
        ...ofTests,
        "2 loads of code that wasn't compiled",
        "LISTED plugins/one.cjs, at src/loads.cjs",
        "LISTED plugins/one.mjs, at src/imports.mjs",
      ]);
    });

    test(`with --aot-allow-code-from-disk a test run loads them, ${form}`, async () => {
      using directory = tempDir("a-computed-load-of-the-product-with-the-flag", files);
      expect(await testRun(String(directory), ["--aot", "--aot-allow-code-from-disk"], words)).toEqual([
        ...loaded,
        ...ofTests,
      ]);
    });
  }

  // Whether an executable holds a native addon is a matter of how it is packaged: the build finds the file, or is given it, or a plugin leaves it out.
  // A test run cannot know which, so the addon loads as in plain Bun, and the run says so when it ends.
  const systemCC = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
  const withAddon = {
    "package.json": files["package.json"],
    "setup/preload.mjs": "",
    "src/loads.cjs": files["src/loads.cjs"],
    "main.cjs": `
    const it = require("./src/loads.cjs").load(process.cwd() + "/native/" + ["adds", "node"].join("."));
    console.log("SAID the addon:", typeof it === "string" ? it : it.add(40, 2));`,
    "test/product.test.cjs": `require("bun:test").test("the product", () => void require("../main.cjs"));`,
  };

  if (part === 4)
    describe.skipIf(!systemCC || isWindows)("a native addon", () => {
      let directory: ReturnType<typeof tempDir> | undefined;
      beforeAll(async () => {
        directory = tempDir("a-computed-load-of-an-addon", { ...withAddon, "native/.keep": "" });
        const compiled = await run(
          [
            systemCC!,
            "-shared",
            "-fPIC",
            ...(process.platform === "darwin" ? ["-undefined", "dynamic_lookup"] : []),
            "-I" + resolve(import.meta.dir, "../../src/runtime/napi"),
            join(import.meta.dir, "addons-named-by-the-platform", "addon.c"),
            "-o",
            join(String(directory), "native", "adds.node"),
          ],
          String(directory),
        );
        expect(compiled).toMatchObject({ exitCode: 0 });
      });
      afterAll(() => directory?.[Symbol.dispose]());

      const build = async (name: string, ...given: string[]) => {
        const file = join(String(directory), name);
        const built = await run(
          [bunExe(), "build", "--compile", "--aot", "./main.cjs", ...given, "--outfile", file],
          String(directory),
        );
        expect(built).toMatchObject({ exitCode: 0 });
        return said((await run([file], String(directory))).stdout);
      };
      test("loads in plain Bun", async () => {
        expect(await testRun(String(directory), [])).toEqual(["SAID the addon: 42"]);
      });
      test("is refused by an executable whose build didn't find it", async () => {
        expect(await build("without")).toEqual([
          "SAID the addon: REFUSED it isn't in this executable, and names the flag",
        ]);
      });
      test("loads in an executable whose build was given it", async () => {
        expect(await build("given", "./native/adds.node")).toEqual(["SAID the addon: 42"]);
      });
      test.each(forms)(
        "that the build didn't find loads in a test run wherever the call stands, and the run lists it: %s",
        async (_, words) => {
          expect(await testRun(String(directory), ["--aot"], words)).toEqual([
            "SAID the addon: 42",
            "1 native addon that the build didn't find",
            "LISTED native/adds.node, at src/loads.cjs",
          ]);
        },
      );
      test("loads in a test run with --aot-allow-code-from-disk, which lists nothing", async () => {
        expect(await testRun(String(directory), ["--aot", "--aot-allow-code-from-disk"])).toEqual([
          "SAID the addon: 42",
        ]);
      });
    });
}
