// An executable compiled ahead of time never starts the JIT and never acts as `bun`, so `bun build --compile --aot` leaves both out, with or without --trim.
// So does the test runner where nothing in the executable can come by it: trim-keeps-the-test-runner-only-when-named.test.ts.
// What the program itself can use stays. Each way into what was left out answers with a sentence.
import { describe, expect } from "bun:test";
import { bunEnv, bunExe, isWindows } from "harness";
import { join } from "node:path";
import { canTrim, model } from "../bundler/compile-trim-features";
import { unsupported } from "./harness/compiler";
import { test } from "./harness/default-timeout";
import { run } from "./harness/run";
import { sharedBuilds, sizeOf, type Build } from "./harness/shared-builds";
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
  "serves-with-options-nobody-knows.ts": `
    const more = JSON.parse(process.env.MADE_UP_OPTIONS ?? "{}");
    const server = Bun.serve({ port: 0, fetch: () => new Response("served"), ...more });
    console.log(await (await fetch(server.url)).text());
    server.stop(true);
  `,
  "imports-from-outside.ts": `
    // @ts-ignore
    import { made } from "made-up-package";
    console.log(made());
  `,
  "reads-build-off-a-value-nobody-knows.ts": `
    console.log(new Function("return " + process.argv[2]!)());
    const maker = JSON.parse(process.argv[3] ?? "null") ?? { build: () => "made" };
    console.log(maker.build());
  `,
  "keeps-the-global-object-in-a-private-field.ts": `
    interface Waits {
      setTimeout(callback: () => void, after: number): unknown;
    }
    class Alarm {
      #host: Waits;
      constructor(host: Waits = globalThis) {
        this.#host = host;
      }
      ring(callback: () => void) {
        return this.#host.setTimeout(callback, 1);
      }
    }
    const maker = JSON.parse(process.argv[2] ?? "null") ?? { build: () => "made" };
    console.log(maker.build());
    new Alarm().ring(() => console.log("rang"));
  `,
  "builds-with-a-bun-that-is-handed-on.ts": `
    const hand = (all: typeof Bun) => all.build({ entrypoints: [process.env.FOLDER + "/entry.ts"], check: true });
    console.log((await hand(Bun)).success);
  `,
  "builds-off-a-private-field.ts": `
    class Holder {
      #host: typeof globalThis;
      constructor(host: typeof globalThis = globalThis) {
        this.#host = host;
      }
      make() {
        return this.#host.Bun.build({ entrypoints: [process.env.FOLDER + "/entry.ts"], check: true });
      }
    }
    console.log((await new Holder().make()).success);
  `,
  "builds-with-what-it-took-out-of-bun.ts": `
    const { build } = Bun;
    console.log((await build({ entrypoints: [process.env.FOLDER + "/entry.ts"], check: true })).success);
  `,
  "bundles-beside-evaluated-text.ts": `
    console.log(new Function("return " + process.argv[2]!)());
    const entrypoints = [process.env.FOLDER + "/entry.ts"];
    console.log((await Bun.build({ entrypoints, target: "bun", format: "esm", minify: true, metafile: true })).success);
  `,
  "spells-bun-build-in-a-text.ts": `
    const text = "return Bun.build({ entrypoints: [process.env.FOLDER + '/entry.ts'], target: 'bun' })";
    console.log((await new Function(text)()).success);
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
  "builds-from-text.ts": `
    try {
      console.log((await new Function("return " + process.argv[2]!)()).success);
    } catch (error) {
      console.log(((error as AggregateError).errors?.[0] ?? (error as Error)).message);
    }
  `,
  "entry.ts": `console.log("built by an executable" as string);`,
  "installs/bunfig.toml": `[install]\nauto = "force"\n`,
};

const commandLineAndJit = model.features
  .filter(each => each.enteredFrom === "command-line" || each.name === "JIT")
  .map(each => each.name)
  .sort();
const commandLineJitAndTestRunner = [...commandLineAndJit, "Test"].sort();
const compilers = ["AotCompiler", "Check", "ImageCompiler", "JIT"];
const lacks = (option: string, part: string, name: string) =>
  `${option}: this executable doesn't include ${part}. To keep ${part}, build it with trim: { allow: ["bundler", "${name}"] }`;
const noCommandLine =
  "can't be used with this executable because it doesn't include the Bun command line. Run bun instead";

function removedFeaturesOf(executable: Build): string[] {
  const removed = readRemovedFeatures(executable.file);
  if (removed === undefined) throw new Error(`${executable.name} has no list of removed features`);
  // What compiled code alone calls stays or leaves by the list of the image: ../bundler/compile-trim-operations.test.ts.
  return model.features
    .filter(feature => removed.includes(feature.index) && feature.enteredFrom !== "compiled-code")
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
    expect(removedFeaturesOf(hello)).toEqual(commandLineJitAndTestRunner);
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
    expect(removedFeaturesOf(executable)).toEqual(commandLineAndJit);
    expect(await run([executable.executable, "6 * 7", "^a+$"], folder)).toEqual({
      stdout: "42 42 true\n20000\n",
      stderr: "",
      exitCode: 0,
    });
  }, 600_000);

  test("a server with options that nobody knows keeps no compiler", async () => {
    const executable = await built("serves-with-options-nobody-knows");
    expect(removedFeaturesOf(executable)).toEqual(commandLineAndJit);
    expect(await run([executable.executable], folder)).toEqual({ stdout: "served\n", stderr: "", exitCode: 0 });
  }, 600_000);

  test("a build that admits the inspector keeps no compiler for it", async () => {
    const hello = await built("hello", ["--compile-inspector"]);
    expect(removedFeaturesOf(hello)).toEqual(commandLineAndJit);
    expect(await run([hello.executable], folder)).toEqual({ stdout: "hello world\n", stderr: "", exitCode: 0 });
  }, 600_000);

  test("a text that spells Bun.build keeps no compiler", async () => {
    const spells = await built("spells-bun-build-in-a-text");
    expect(removedFeaturesOf(spells)).toEqual(commandLineAndJit);
    expect(await run([spells.executable], folder, { ...bunEnv, FOLDER: folder })).toEqual({
      stdout: "true\n",
      stderr: "",
      exitCode: 0,
    });
  }, 600_000);

  test("a package that is left outside the executable keeps no compiler in it", async () => {
    const executable = await built("imports-from-outside", ["--external", "made-up-package"]);
    expect(removedFeaturesOf(executable)).toEqual(commandLineAndJit);
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

  test("a method named build of a value that nobody knows keeps no compiler", async () => {
    const reads = await built("reads-build-off-a-value-nobody-knows");
    expect(removedFeaturesOf(reads)).toEqual(commandLineAndJit);
    expect(await run([reads.executable, "6 * 7"], folder)).toEqual({ stdout: "42\nmade\n", stderr: "", exitCode: 0 });
    const keeps = await built("keeps-the-global-object-in-a-private-field");
    expect(removedFeaturesOf(keeps)).toEqual(commandLineAndJit);
    expect(await run([keeps.executable], folder)).toEqual({ stdout: "made\nrang\n", stderr: "", exitCode: 0 });
  }, 600_000);

  test.each([
    "builds-with-a-bun-that-is-handed-on",
    "builds-off-a-private-field",
    "builds-with-what-it-took-out-of-bun",
  ])(
    "%s: the compiler sees Bun.build used, and the type checker stays",
    async program => {
      const builds = await built(program);
      const removed = removedFeaturesOf(builds);
      for (const feature of compilers) expect(removed).not.toContain(feature);
      expect(await run([builds.executable], folder, { ...bunEnv, FOLDER: folder })).toEqual({
        stdout: "true\n",
        stderr: "",
        exitCode: 0,
      });
    },
    600_000,
  );

  test("a program that asks Bun.build for a bundle alone keeps no compiler", async () => {
    const bundles = await built("bundles-beside-evaluated-text");
    expect(removedFeaturesOf(bundles)).toEqual(commandLineAndJit);
    expect(await run([bundles.executable, "6 * 7"], folder, { ...bunEnv, FOLDER: folder })).toEqual({
      stdout: "42\ntrue\n",
      stderr: "",
      exitCode: 0,
    });
  }, 600_000);

  test("a program that calls Bun.build with options that nobody knows keeps the type checker, the compiler and the JIT", async () => {
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
        [
          lacks("check", "the type checker", "check"),
          lacks("compile.aot", "the ahead-of-time compiler", "aot"),
          "true",
        ].join("\n") + "\n",
      stderr: "",
      exitCode: 0,
    });
  }, 600_000);

  test("evaluated text finds Bun.build, which bundles for it and says what it lacks", async () => {
    const executable = await built("builds-from-text");
    expect(removedFeaturesOf(executable)).toEqual(commandLineAndJit);
    const entrypoints = `entrypoints: [process.env.FOLDER + "/entry.ts"]`;
    const outfile = `outfile: process.env.FOLDER + "/built-from-text"`;
    for (const [options, said] of [
      [`target: "bun"`, "true"],
      [`check: true`, lacks("check", "the type checker", "check")],
      [`compile: { aot: true, ${outfile} }`, lacks("compile.aot", "the ahead-of-time compiler", "aot")],
      [`compile: { ${outfile} }`, lacks("compile", "the JIT compilers", "jit")],
    ]) {
      const text = `Bun.build({ ${entrypoints}, ${options} })`;
      expect(await run([executable.executable, text], folder, { ...bunEnv, FOLDER: folder })).toEqual({
        stdout: said + "\n",
        stderr: "",
        exitCode: 0,
      });
    }
  }, 600_000);

  test.each([
    ["check", `check: true`],
    ["aot", `compile: { aot: true, outfile: process.env.FOLDER + "/kept-aot" }`],
    ["jit", `compile: { outfile: process.env.FOLDER + "/kept-jit" }`],
  ])(
    'an executable built with trim: { allow: ["bundler", %j] } does what the refusal says it would',
    async (name, options) => {
      const outfile = join(folder, `allows-${name}`);
      const builds = `await Bun.build({ entrypoints: [${JSON.stringify(join(folder, "builds-from-text.ts"))}], compile: { aot: true, outfile: ${JSON.stringify(outfile)}, trim: { allow: ["bundler", ${JSON.stringify(name)}] } } })`;
      expect(await run([bunExe(), "-e", `console.log((${builds}).success)`], folder)).toMatchObject({
        stdout: "true\n",
        exitCode: 0,
      });
      const text = `Bun.build({ entrypoints: [process.env.FOLDER + "/entry.ts"], ${options} })`;
      expect(await run([outfile, text], folder, { ...bunEnv, FOLDER: folder })).toEqual({
        stdout: "true\n",
        stderr: "",
        exitCode: 0,
      });
    },
    600_000,
  );

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
