// A flag that --aot can't honour is answered in words: refused, or noted where the build goes on. None is swallowed.
import { expect } from "bun:test";
import { existsSync, readFileSync, realpathSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { spawned } from "./harness/commands";
import { test } from "./supported";

const files = {
  "entry.js": `import { second } from "./second.js";\nconsole.log("hello", second);\n`,
  "second.js": `export const second = "second";\n`,
  "a.test.js": `import { test, expect } from "bun:test";\ntest("one", () => { expect(1).toBe(1); });\n`,
};
const app = isWindows ? "app.exe" : "app";
const build = ["build", "--compile", "--aot"];
const both = "Cannot use both --aot and --no-aot";
const declarations = "--dts requires --outdir, and cannot be used with --compile";

const refused: [string[], string][] = [
  [[...build, "--watch", "./entry.js", "--outfile", app], "--aot does not support --watch"],
  [["compile", "--watch", "./entry.js", "--outfile", app], "bun compile does not support --watch"],
  [["build", "--compile", "--AOT", "./entry.js", "--outfile", app], "unknown flag --AOT. Did you mean --aot?"],
  [["build", "--compile", "--Aot", "./entry.js", "--outfile", app], "unknown flag --Aot. Did you mean --aot?"],
  [["compile", "--AOT", "./entry.js", "--outfile", app], "unknown flag --AOT. Did you mean --aot?"],
  [["test", "--AOT"], "unknown flag --AOT. Did you mean --aot?"],
  [["run", "--AOT", "./entry.js"], "unknown flag --AOT. Did you mean --aot?"],
  [["--AOT", "./entry.js"], "unknown flag --AOT. Did you mean --aot?"],
  [[...build, "--no-aot", "./entry.js", "--outfile", app], both],
  [["build", "--compile", "--no-aot", "--aot", "./entry.js", "--outfile", app], both],
  [["test", "--aot", "--no-aot"], both],
  [[...build, "--dts", "./entry.js", "--outfile", app], declarations],
  [["compile", "--dts", "./entry.js", "--outfile", app], declarations],
  [["compile", "--app", "./entry.js", "--outfile", app], "bun compile does not support --app"],
];

test.each(refused)(
  "bun %j is refused",
  async (command, words) => {
    using dir = tempDir("aot-flags-answered", files);
    const root = realpathSync(String(dir));
    const run = await spawned([bunExe(), ...command], root, bunEnv);
    expect({ stderr: run.stderr, exitCode: run.exitCode }).toEqual({
      stderr: expect.stringContaining(words),
      exitCode: 1,
    });
    expect(existsSync(join(root, app))).toBe(false);
  },
  120_000,
);

const noted: [string, string][] = [
  ["--bytecode", "note: --bytecode has no effect with --aot"],
  ["--format=cjs", "note: --format has no effect with --aot"],
  ["--format=iife", "note: --format has no effect with --aot"],
];

test.each(noted)(
  "%s is noted and the program is compiled",
  async (flag, words) => {
    using dir = tempDir("aot-flags-answered", files);
    const root = realpathSync(String(dir));
    const run = await spawned([bunExe(), ...build, flag, "./entry.js", "--outfile", app], root, bunEnv);
    expect({ stderr: run.stderr, exitCode: run.exitCode }).toEqual({
      stderr: expect.stringContaining(words),
      exitCode: 0,
    });
    expect(run.stdout).toMatch(/^ +build id  [0-9a-f]{32}$/m);
    expect((await spawned([join(root, app)], root, bunEnv)).stdout).toBe("hello second\n");
  },
  120_000,
);

test.each(["AOT", "Aot"])(
  "compile: { %s: true } is refused",
  async key => {
    using dir = tempDir("aot-flags-answered", {
      ...files,
      "build.js": `
      try {
        await Bun.build({ entrypoints: ["./entry.js"], compile: { ${key}: true, outfile: "./${app}" } });
        console.log("built");
      } catch (error) {
        console.log(error.message);
      }
    `,
    });
    const root = realpathSync(String(dir));
    const run = await spawned([bunExe(), "build.js"], root, bunEnv);
    expect(run.stdout).toStartWith(`compile.${key} is not a valid option. Did you mean compile.aot?`);
  },
  120_000,
);

// `bun compile` compiles by default, and of HTML entry points `--target=browser` makes a page, which is not compiled.
test.each([["compile"], build])(
  "bun %s --watch --target=browser still watches a page",
  async (...command) => {
    using dir = tempDir("aot-flags-answered", { "page.html": "<!doctype html>\n<p>first</p>\n" });
    const root = realpathSync(String(dir));
    await using watcher = Bun.spawn({
      cmd: [
        bunExe(),
        ...command,
        "--watch",
        "--no-clear-screen",
        "--target=browser",
        "./page.html",
        "--outfile",
        "out.html",
      ],
      cwd: root,
      env: bunEnv,
      stdout: "pipe",
      stderr: "inherit",
    });
    const isRebuilt = () => readFileSync(join(root, "out.html"), "utf8").includes("second");
    let said = "";
    let isChanged = false;
    for await (const chunk of watcher.stdout) {
      said += new TextDecoder().decode(chunk);
      if (isChanged && isRebuilt()) break;
      if (!isChanged && said.includes("Bundled ")) {
        isChanged = true;
        writeFileSync(join(root, "page.html"), "<!doctype html>\n<p>second</p>\n");
      }
    }
    expect(readFileSync(join(root, "out.html"), "utf8")).toContain("second");
  },
  120_000,
);

test("without --aot the other commands go on as they did", async () => {
  using dir = tempDir("aot-flags-answered", files);
  const root = realpathSync(String(dir));
  const built = await spawned(
    [bunExe(), "build", "--compile", "--no-aot", "./entry.js", "--outfile", app],
    root,
    bunEnv,
  );
  const tested = await spawned([bunExe(), "test", "--no-aot"], root, bunEnv);
  expect([built.exitCode, tested.exitCode]).toEqual([0, 0]);
  expect(built.stdout).not.toContain("build id");
}, 120_000);
