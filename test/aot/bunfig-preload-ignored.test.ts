// An executable built with --aot runs only what was compiled into it, so it leaves the `preload` of the bunfig.toml in its working directory alone.
// That file may be there for `bun`, so it doesn't stop the program: the executable says that it ignores the preload, once, on stderr, and goes on.
// A file that --config names is asked of this very process: a preload in it is refused, as --preload is.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

const files = {
  "build/entry.ts": `console.log("ENTRY", typeof (globalThis as any).fromPreload);`,
  "preload/bunfig.toml": `preload = ["./preload.ts"]\n`,
  "preload/preload.ts": `(globalThis as any).fromPreload = 1; console.log("PRELOAD");`,
  "missing/bunfig.toml": `preload = ["./nothing.ts"]\n`,
  "plugins/bunfig.toml": `[serve.static]\nplugins = ["./plugin.ts"]\n`,
  "both/bunfig.toml": `preload = ["./nothing.ts"]\n[serve.static]\nplugins = ["./plugin.ts"]\n`,
  "other/bunfig.toml": `[console]\ndepth = 1\n`,
  "named/own.toml": `preload = ["./preload.ts"]\n`,
  "named/preload.ts": `(globalThis as any).fromPreload = 1; console.log("PRELOAD");`,
  "named/quiet.toml": `[console]\ndepth = 1\n`,
};

const reason =
  "because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code\n";
const ignored = `warn: "preload" in bunfig.toml is ignored by this executable ${reason}`;
const withoutPreload = "ENTRY undefined\n";
const withPreload = "PRELOAD\nENTRY number\n";

async function spawned(cmd: string[], cwd: string, env: Record<string, string | undefined> = bunEnv) {
  await using child = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  return { stdout, stderr: stderr.replaceAll("\r\n", "\n"), exitCode };
}

async function build(folder: string, name: string, flags: string[]) {
  const outfile = join(folder, name + (isWindows ? ".exe" : ""));
  const built = await spawned(
    [bunExe(), "build", "--compile", ...flags, "./entry.ts", "--outfile", outfile],
    join(folder, "build"),
  );
  expect(built.exitCode ? built : 0).toBe(0);
  return outfile;
}

test("--aot says that it ignores the preload of the bunfig.toml, and runs", async () => {
  using folder = tempDir("bunfig-preload-ignored", files);
  const executable = await build(String(folder), "compiled", ["--aot"]);
  const runIn = (name: string) => spawned([executable], join(String(folder), name));
  expect(await runIn("preload")).toEqual({ stdout: withoutPreload, stderr: ignored, exitCode: 0 });
  expect(await runIn("missing")).toEqual({ stdout: withoutPreload, stderr: ignored, exitCode: 0 });
  expect(await runIn("both")).toEqual({ stdout: withoutPreload, stderr: ignored, exitCode: 0 });
  // The build has run the plugins over the pages: nothing is lost.
  expect(await runIn("plugins")).toEqual({ stdout: withoutPreload, stderr: "", exitCode: 0 });
  expect(await runIn("other")).toEqual({ stdout: withoutPreload, stderr: "", exitCode: 0 });
  expect(await runIn("build")).toEqual({ stdout: withoutPreload, stderr: "", exitCode: 0 });
});

test("--aot refuses the preload of a file that --config names", async () => {
  using folder = tempDir("bunfig-preload-named", files);
  const executable = await build(String(folder), "compiled", ["--aot"]);
  const startedWith = (options: string) =>
    spawned([executable], join(String(folder), "named"), { ...bunEnv, BUN_OPTIONS: options });
  expect(await startedWith("--config=own.toml")).toEqual({
    stdout: "",
    stderr: `error: "preload" in own.toml can't be used with this executable ${reason}`,
    exitCode: 1,
  });
  expect(await startedWith("--config=quiet.toml")).toEqual({ stdout: withoutPreload, stderr: "", exitCode: 0 });
});

test("--aot --no-compile-autoload-bunfig reads no bunfig.toml and says nothing", async () => {
  using folder = tempDir("bunfig-preload-not-read", files);
  const executable = await build(String(folder), "compiled", ["--aot", "--no-compile-autoload-bunfig"]);
  for (const name of ["preload", "missing", "plugins", "both"]) {
    expect(await spawned([executable], join(String(folder), name))).toEqual({
      stdout: withoutPreload,
      stderr: "",
      exitCode: 0,
    });
  }
});

test("--aot --compile-inspector runs the preload, as the warning says", async () => {
  using folder = tempDir("bunfig-preload-with-inspector", files);
  const executable = await build(String(folder), "compiled", ["--aot", "--compile-inspector"]);
  expect(await spawned([executable], join(String(folder), "preload"))).toEqual({
    stdout: withPreload,
    stderr: "",
    exitCode: 0,
  });
});

test("without --aot the preload runs and nothing is said", async () => {
  using folder = tempDir("bunfig-preload-plain", files);
  const executable = await build(String(folder), "plain", []);
  expect(await spawned([executable], join(String(folder), "preload"))).toEqual({
    stdout: withPreload,
    stderr: "",
    exitCode: 0,
  });
  expect(
    await spawned([bunExe(), "run", join(String(folder), "build", "entry.ts")], join(String(folder), "preload")),
  ).toEqual({
    stdout: withPreload,
    stderr: "",
    exitCode: 0,
  });
});
