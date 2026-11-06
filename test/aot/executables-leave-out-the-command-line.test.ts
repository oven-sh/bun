// An executable compiled ahead of time leaves the command line and JIT out unless explicitly retained.
// What the program itself can use stays. Each way into what was left out answers with a sentence.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes } from "harness";
import { join } from "node:path";
import { canTrim, model } from "../bundler/compile-trim-features";
import { unsupported } from "./harness/compiler";
import { run } from "./harness/run";
import { sharedBuilds, sizeOf, type Build } from "./harness/shared-builds";
import { copyWithoutDebugInformation as executablePath } from "./harness/without-debug-information";
import { readRemovedFeatures } from "./trimmed-against-whole/removed-features";

const programs = {
  "hello.ts": `console.log("hello world");`,
  "evaluates-text.ts": `
    const text = process.argv[2]!;
    console.log((0, eval)(text), new Function("return " + text)(), new RegExp(process.argv[3]!).test("aaa"));
    const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11]);
    const { instance } = await WebAssembly.instantiate(bytes);
    let sum = 0;
    for (let i = 0; i < 20000; i++) sum = (instance.exports.add as (a: number, b: number) => number)(sum, 1);
    console.log(sum);
  `,
  "builds.ts": `
    const entrypoints = [process.env.FOLDER + "/entry.ts"];
    for (const options of [{ check: true }, { compile: { aot: true, outfile: process.env.FOLDER + "/built" } }, { target: "bun" as const }]) {
      try {
        console.log((await Bun.build({ entrypoints, ...options })).success);
      } catch (error) {
        console.log(((error as AggregateError).errors?.[0] ?? (error as Error)).message);
      }
    }
  `,
  "entry.ts": `console.log("built by an executable" as string);`,
  "installs/bunfig.toml": `[install]\nauto = "force"\n`,
};

const commandLineAndJit = model.features
  .filter(each => each.enteredFrom === "command-line" || each.name === "JIT")
  .map(each => each.name)
  .sort();
const compilers = ["AotCompiler", "Check", "ImageCompiler", "JIT"];
const noCommandLine =
  "can't be used with this executable because it doesn't include the Bun command line. Run bun instead";

function removedFeaturesOf(executable: Pick<Build, "file" | "name">): string[] {
  const removed = readRemovedFeatures(executable.file);
  if (removed === undefined) throw new Error(`${executable.name} has no list of removed features`);
  return model.features
    .filter(feature => removed.includes(feature.index))
    .map(feature => feature.name)
    .sort();
}

(canTrim && !unsupported ? describe.concurrent : describe.skip)("bun build --compile --aot, without --trim", () => {
  const shared = sharedBuilds("aot-without-the-command-line", programs);
  const { folder } = shared;
  async function built(program: string, flags: string[] = []) {
    const build = await shared.build(`${program}.ts`, "--aot", ...flags);
    expect(build.stderr).not.toMatch(/^error\b|compile\.trim/m);
    return build;
  }

  test("leaves out the command line and the JIT, and nothing a program can use", async () => {
    const hello = await built("hello");
    expect(removedFeaturesOf(hello)).toEqual(commandLineAndJit);
    expect(await run([hello.executable], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    expect(sizeOf(await shared.build("hello.ts")) - sizeOf(hello)).toBeGreaterThan(30_000_000);
  }, 600_000);

  test("install.auto in a bunfig.toml beside the program doesn't stop it", async () => {
    const hello = await built("hello");
    expect(await run([hello.executable], join(folder, "installs"))).toEqual({
      stdout: "hello world\n",
      stderr: "",
      exitCode: 0,
    });
  }, 600_000);

  test("text, regular expressions from text and WebAssembly run as they did", async () => {
    const executable = await built("evaluates-text");
    expect(await run([executable.executable, "6 * 7", "^a+$"], folder)).toEqual({
      stdout: "42 42 true\n20000\n",
      stderr: "",
      exitCode: 0,
    });
  }, 600_000);

  test("BUN_BE_BUN=1 says to run bun", async () => {
    const hello = await built("hello");
    const asBun = { ...bunEnv, BUN_BE_BUN: "1" };
    for (const args of [["install"], ["run", "hello.ts"], ["-e", "1"], ["hello.ts"], []]) {
      expect(await run([hello.executable, ...args], folder, asBun)).toEqual({
        stdout: "",
        // It is written to C's descriptor 2, which translates line ends on Windows.
        stderr: `error: BUN_BE_BUN is set, but this executable doesn't include the Bun command line. Run bun instead.${isWindows ? "\r\n" : "\n"}`,
        exitCode: 70,
      });
    }
    expect(await run([hello.executable, "--version"], folder, asBun)).toEqual({
      stdout: Bun.version + "\n",
      stderr: "",
      exitCode: 0,
    });
  }, 600_000);

  test("retaining run executes external ESM and a CommonJS package without the JIT", async () => {
    using dir = tempDirWithBunTypes("aot-as-bun", {
      "entry.ts": `console.log("compiled entry");`,
      "build.ts": `
        const result = await Bun.build({
          entrypoints: ["./entry.ts"],
          compile: {
            outfile: "./app", aot: true, trim: { allow: ["run"] },
            ...${JSON.stringify(executablePath ? { executablePath } : {})},
          },
        });
        if (!result.success) throw new AggregateError(result.logs);
      `,
      "external.mjs": `
        import { basename } from "node:path";
        const shared = new Int32Array(new SharedArrayBuffer(4));
        Atomics.store(shared, 0, 42);
        const clone = new Int32Array(structuredClone(shared.buffer));
        Atomics.store(clone, 0, 43);
        console.log(basename(import.meta.filename), [1, 2, 3].map(x => x * 2).join(","), Atomics.load(shared, 0));
      `,
      "node_modules/tiny/package.json": `{"name":"tiny","version":"1.0.0","bin":"bin/cli.cjs"}`,
      "node_modules/tiny/bin/cli.cjs": `#!/usr/bin/env node\nrequire("../lib/cli.cjs")(process);`,
      "node_modules/tiny/lib/cli.cjs": `
        const { basename } = require("node:path");
        module.exports = process => console.log(basename(process.argv[1]), /cli/.test(process.argv[1]), JSON.parse('{"answer":42}').answer);
      `,
    });
    const folder = String(dir);
    expect(await run([bunExe(), "build.ts"], folder)).toEqual({ stdout: "", stderr: "", exitCode: 0 });
    const app = join(folder, "app");
    const removed = removedFeaturesOf({ name: "app", file: app + (isWindows ? ".exe" : "") });
    expect(removed).not.toContain("Tools");
    expect(removed).toContain("JIT");
    const asBun = { ...bunEnv, BUN_BE_BUN: "1" };
    expect(await run([app, "external.mjs"], folder, asBun)).toEqual({
      stdout: "external.mjs 2,4,6 43\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await run([app, "node_modules/tiny/bin/cli.cjs"], folder, asBun)).toEqual({
      stdout: "cli.cjs true 42\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await run([app], folder)).toEqual({ stdout: "compiled entry\n", stderr: "", exitCode: 0 });
  });

  test.each(["--help", "-h", "--check", "--aot", "-i"])(
    "%s in BUN_OPTIONS says to run bun",
    async option => {
      const hello = await built("hello");
      const label = option === "-h" ? "--help" : option;
      expect(await run([hello.executable], folder, { ...bunEnv, BUN_OPTIONS: option })).toEqual({
        stdout: "",
        stderr: `error: ${label} ${noCommandLine}\n`,
        exitCode: 1,
      });
    },
    600_000,
  );

  test("an option in --compile-exec-argv keeps what it needs", async () => {
    const hello = await built("hello", ["--compile-exec-argv=--help"]);
    expect(removedFeaturesOf(hello)).not.toContain("Tools");
  }, 600_000);

  test("a program that calls Bun.build keeps the type checker, the compiler and the JIT", async () => {
    const builds = await built("builds");
    const removed = removedFeaturesOf(builds);
    for (const feature of compilers) expect(removed).not.toContain(feature);
    expect(removed).toContain("Lint");
    const ran = await run([builds.executable], folder, { ...bunEnv, FOLDER: folder });
    expect(ran).toEqual({
      stdout: "true\ntrue\ntrue\n",
      stderr: "",
      exitCode: 0,
    });
    expect(await run([join(folder, "built")], folder)).toEqual({
      stdout: "built by an executable\n",
      stderr: "",
      exitCode: 0,
    });
  }, 600_000);

  test("with the type checker and the compiler forced out, Bun.build still bundles, and says what it lacks", async () => {
    const builds = await built("builds", [`--trim-without=${compilers.join(",")}`]);
    expect(removedFeaturesOf(builds)).toEqual(commandLineAndJit);
    expect(await run([builds.executable], folder, { ...bunEnv, FOLDER: folder })).toEqual({
      stdout:
        "check: this executable doesn't include the type checker\ncompile.aot isn't available in this build of Bun\ntrue\n",
      stderr: "",
      exitCode: 0,
    });
  }, 600_000);

  test("bun build --compile without --aot copies Bun whole", async () => {
    const plain = await shared.build("hello.ts");
    expect(removedFeaturesOf(plain)).toEqual([]);
    expect(await run([plain.executable, "-e", "console.log(1 + 1)"], folder, { ...bunEnv, BUN_BE_BUN: "1" })).toEqual({
      stdout: "2\n",
      stderr: "",
      exitCode: 0,
    });
  }, 600_000);
});
