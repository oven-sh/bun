import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./supported";

// `--sql-preconnect` makes the start read `Bun.sql` and call its `connect()` before the program runs. A build sees the option only in --compile-exec-argv.
async function build(folder: string, entry: string, ...flags: string[]) {
  const executable = join(folder, entry.replace(/\.ts$/, isWindows ? ".exe" : ""));
  await using built = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", "--aot", ...flags, entry, "--outfile", executable],
    cwd: folder,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect({
    stderr: (await built.stderr.text()).split("\n").filter(line => line.startsWith("error")),
    exitCode: await built.exited,
  }).toEqual({
    stderr: [],
    exitCode: 0,
  });
  return executable;
}

async function run(executable: string, options: string | undefined) {
  // Nothing listens there: the connection is refused at once, and a preconnect that fails says nothing.
  const env = { ...bunEnv, DATABASE_URL: "postgres://127.0.0.1:1/nothing", BUN_OPTIONS: options };
  await using ran = Bun.spawn({ cmd: [executable], env, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, errors: stderr.split("\n").filter(line => line.startsWith("error")), exitCode };
}

const refusal =
  "error: --sql-preconnect can't be used with this executable: the program never uses Bun.sql, so it wasn't compiled in. Rebuild with --compile-exec-argv=--sql-preconnect";

test("--sql-preconnect as an option of the run", async () => {
  using dir = tempDir("aot-option-of-the-run", {
    "tsconfig.json": "{}",
    "silent.ts": `console.log("ran");`,
    "told.ts": `console.log("ran");`,
    "names.ts": `console.log(typeof Bun.sql.connect);`,
  });
  const folder = String(dir);
  const silent = await build(folder, "silent.ts");
  expect(await run(silent, undefined)).toEqual({ stdout: "ran\n", errors: [], exitCode: 0 });
  expect(await run(silent, "--sql-preconnect")).toEqual({ stdout: "", errors: [refusal], exitCode: 1 });
  const told = await build(folder, "told.ts", "--compile-exec-argv=--sql-preconnect");
  expect(await run(told, undefined)).toEqual({ stdout: "ran\n", errors: [], exitCode: 0 });
  expect(await run(told, "--sql-preconnect")).toEqual({ stdout: "ran\n", errors: [], exitCode: 0 });
  const names = await build(folder, "names.ts");
  expect(await run(names, "--sql-preconnect")).toEqual({ stdout: "function\n", errors: [], exitCode: 0 });
}, 240_000);
