// An executable compiled ahead of time never starts the JIT and never acts as `bun`, so `bun build --compile --aot` leaves both out, with or without --trim.
// What the program itself can use stays. Each way into what was left out answers with a sentence.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { statSync } from "node:fs";
import { join } from "node:path";
import { canTrim, model } from "../bundler/compile-trim-features";
import { run } from "./harness/run";
import { unsupported } from "./run-programs";
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
};

const commandLineAndJit = model.features
  .filter(each => each.enteredFrom === "command-line" || each.name === "JIT")
  .map(each => each.name)
  .sort();
const compilers = ["AotCompiler", "Check", "ImageCompiler", "JIT"];
const noCommandLine =
  "can't be used with this executable because it doesn't include the Bun command line. Run bun instead";

function removedFeaturesOf(executable: string): string[] {
  const removed = readRemovedFeatures(executable + (isWindows ? ".exe" : ""));
  if (removed === undefined) throw new Error(`${executable} has no list of removed features`);
  return model.features
    .filter(feature => removed.includes(feature.index))
    .map(feature => feature.name)
    .sort();
}

describe.skipIf(!canTrim || !!unsupported)("bun build --compile --aot, without --trim", () => {
  async function built(program: string, folder: string, flags: string[] = []) {
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", ...flags, `${program}.ts`, "--outfile", program],
      folder,
    );
    expect(build.stderr).not.toMatch(/^error\b|compile\.trim/m);
    expect(build.exitCode).toBe(0);
    return join(folder, program);
  }

  test("leaves out the command line and the JIT, and nothing a program can use", async () => {
    using dir = tempDir("aot-without-the-command-line", programs);
    const folder = String(dir);
    const hello = await built("hello", folder);
    expect(removedFeaturesOf(hello)).toEqual(commandLineAndJit);
    expect(await run([hello], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
    expect(await run([bunExe(), "build", "--compile", "hello.ts", "--outfile", "plain"], folder)).toMatchObject({
      exitCode: 0,
    });
    const sizeOf = (executable: string) => statSync(executable + (isWindows ? ".exe" : "")).size;
    expect(sizeOf(join(folder, "plain")) - sizeOf(hello)).toBeGreaterThan(30_000_000);
  }, 600_000);

  test("install.auto in a bunfig.toml beside the program doesn't stop it", async () => {
    using dir = tempDir("aot-without-the-command-line", { ...programs, "bunfig.toml": `[install]\nauto = "force"\n` });
    const folder = String(dir);
    const hello = await built("hello", folder);
    expect(await run([hello], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
  }, 600_000);

  test("text, regular expressions from text and WebAssembly run as they did", async () => {
    using dir = tempDir("aot-without-the-command-line", programs);
    const folder = String(dir);
    const executable = await built("evaluates-text", folder);
    expect(await run([executable, "6 * 7", "^a+$"], folder)).toEqual({
      stdout: "42 42 true\n20000\n",
      stderr: "",
      exitCode: 0,
    });
  }, 600_000);

  test("BUN_BE_BUN=1 says to run bun", async () => {
    using dir = tempDir("aot-without-the-command-line", programs);
    const folder = String(dir);
    const hello = await built("hello", folder);
    const asBun = { ...bunEnv, BUN_BE_BUN: "1" };
    for (const args of [["install"], ["run", "hello.ts"], ["-e", "1"], ["hello.ts"], []]) {
      expect(await run([hello, ...args], folder, asBun)).toEqual({
        stdout: "",
        // It is written to C's descriptor 2, which translates line ends on Windows.
        stderr: `error: BUN_BE_BUN is set, but this executable doesn't include the Bun command line. Run bun instead.${isWindows ? "\r\n" : "\n"}`,
        exitCode: 70,
      });
    }
    expect(await run([hello, "--version"], folder, asBun)).toEqual({
      stdout: Bun.version + "\n",
      stderr: "",
      exitCode: 0,
    });
  }, 600_000);

  test.each(["--help", "-h", "--check", "--aot", "-i"])(
    "%s in BUN_OPTIONS says to run bun",
    async option => {
      using dir = tempDir("aot-without-the-command-line", programs);
      const folder = String(dir);
      const hello = await built("hello", folder);
      const label = option === "-h" ? "--help" : option;
      expect(await run([hello], folder, { ...bunEnv, BUN_OPTIONS: option })).toEqual({
        stdout: "",
        stderr: `error: ${label} ${noCommandLine}\n`,
        exitCode: 1,
      });
    },
    600_000,
  );

  test("an option in --compile-exec-argv keeps what it needs", async () => {
    using dir = tempDir("aot-without-the-command-line", programs);
    const folder = String(dir);
    const hello = await built("hello", folder, ["--compile-exec-argv=--help"]);
    expect(removedFeaturesOf(hello)).not.toContain("Tools");
  }, 600_000);

  test("a program that calls Bun.build keeps the type checker, the compiler and the JIT", async () => {
    using dir = tempDir("aot-without-the-command-line", programs);
    const folder = String(dir);
    const builds = await built("builds", folder);
    const removed = removedFeaturesOf(builds);
    for (const feature of compilers) expect(removed).not.toContain(feature);
    expect(removed).toContain("Lint");
    const ran = await run([builds], folder, { ...bunEnv, FOLDER: folder });
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
    using dir = tempDir("aot-without-the-command-line", programs);
    const folder = String(dir);
    const builds = await built("builds", folder, [`--trim-without=${compilers.join(",")}`]);
    expect(removedFeaturesOf(builds)).toEqual(commandLineAndJit);
    expect(await run([builds], folder, { ...bunEnv, FOLDER: folder })).toEqual({
      stdout:
        "check: this executable doesn't include the type checker\ncompile.aot isn't available in this build of Bun\ntrue\n",
      stderr: "",
      exitCode: 0,
    });
  }, 600_000);

  test("bun build --compile without --aot copies Bun whole", async () => {
    using dir = tempDir("aot-without-the-command-line", programs);
    const folder = String(dir);
    expect(await run([bunExe(), "build", "--compile", "hello.ts", "--outfile", "plain"], folder)).toMatchObject({
      exitCode: 0,
    });
    expect(removedFeaturesOf(join(folder, "plain"))).toEqual([]);
    expect(
      await run([join(folder, "plain"), "-e", "console.log(1 + 1)"], folder, { ...bunEnv, BUN_BE_BUN: "1" }),
    ).toEqual({ stdout: "2\n", stderr: "", exitCode: 0 });
  }, 600_000);
});
