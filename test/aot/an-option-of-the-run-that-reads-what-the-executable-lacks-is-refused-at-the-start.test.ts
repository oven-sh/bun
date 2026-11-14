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
  const warnings = [...stderr.matchAll(/\b(\w+Warning): /g)].map(match => match[1]);
  return { stdout, errors: stderr.split("\n").filter(line => line.startsWith("error")), exitCode, warnings };
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
  expect(await run(silent, undefined)).toEqual({ stdout: "ran\n", errors: [], exitCode: 0, warnings: [] });
  expect(await run(silent, "--sql-preconnect")).toEqual({ stdout: "", errors: [refusal], exitCode: 1, warnings: [] });
  const told = await build(folder, "told.ts", "--compile-exec-argv=--sql-preconnect");
  expect(await run(told, undefined)).toEqual({ stdout: "ran\n", errors: [], exitCode: 0, warnings: [] });
  expect(await run(told, "--sql-preconnect")).toEqual({ stdout: "ran\n", errors: [], exitCode: 0, warnings: [] });
  const names = await build(folder, "names.ts");
  expect(await run(names, "--sql-preconnect")).toEqual({ stdout: "function\n", errors: [], exitCode: 0, warnings: [] });
}, 240_000);

// Every mode of `--unhandled-rejections` makes the run time print a warning for some rejection, with Bun's own JavaScript: `none` and `throw` for a rejection that is handled late. Without the option a promise makes native code call nothing of it.
const refusalOfMode =
  "error: --unhandled-rejections can't be used with this executable: the code that prints its warnings wasn't compiled in. Rebuild with --compile-exec-argv=--unhandled-rejections=<mode>";

test("--unhandled-rejections as an option of the run", async () => {
  const lost = `Promise.reject(new Error("lost"));\nconsole.log("ran");`;
  using dir = tempDir("aot-option-of-the-run", {
    "tsconfig.json": "{}",
    "silent.ts": lost,
    "told.ts": lost,
    "late.ts": `const late = Promise.reject(new Error("late"));\nawait new Promise(done => setImmediate(done));\nlate.catch(error => console.log("caught", error.message));`,
    "warns.ts": `process.emitWarning("own");\n${lost}`,
    "evaluates.ts": `console.log(new Function("return " + (process.env.TEXT_NOBODY_KNOWS ?? "'made'"))());\n${lost}`,
    "lost.js": lost,
  });
  const folder = String(dir);
  const refused = { stdout: "", errors: [refusalOfMode], exitCode: 1, warnings: [] };
  const silent = await build(folder, "silent.ts");
  expect(await run(silent, undefined)).toMatchObject({ stdout: "ran\n", exitCode: 1, warnings: [] });
  for (const mode of ["strict", "throw", "warn", "none", "warn-with-error-code"]) {
    expect(await run(silent, `--unhandled-rejections=${mode}`)).toEqual(refused);
  }
  expect(await run(silent, "--unhandled-rejections warn")).toEqual(refused);
  // Whether the option works doesn't hang on what else the program does: one has what prints warnings, one admits code that the build hasn't seen.
  for (const entry of ["warns.ts", "evaluates.ts"]) {
    expect(await run(await build(folder, entry), "--unhandled-rejections=warn")).toEqual(refused);
  }
  const told = await build(folder, "told.ts", "--compile-exec-argv=--unhandled-rejections=warn");
  const twice = ["UnhandledPromiseRejectionWarning", "UnhandledPromiseRejectionWarning"];
  expect(await run(told, undefined)).toEqual({ stdout: "ran\n", errors: [], exitCode: 0, warnings: twice });
  expect(await run(told, "--unhandled-rejections=warn-with-error-code")).toMatchObject({
    stdout: "ran\n",
    warnings: twice,
  });
  const late = await build(folder, "late.ts", "--compile-exec-argv=--unhandled-rejections=none");
  expect(await run(late, undefined)).toEqual({
    stdout: "caught late\n",
    errors: [],
    exitCode: 0,
    warnings: ["PromiseRejectionHandledWarning"],
  });
  // A program that is compiled in place: the build reads the option off its own command line.
  await using inPlace = Bun.spawn({
    cmd: [bunExe(), "run", "--debug-aot", "--unhandled-rejections=warn", "lost.js"],
    cwd: folder,
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([inPlace.stdout.text(), inPlace.stderr.text(), inPlace.exited]);
  expect({ stdout, warnings: stderr.match(/UnhandledPromiseRejectionWarning: /g)?.length, exitCode }).toEqual({
    stdout: "ran\n",
    warnings: 2,
    exitCode: 0,
  });
}, 240_000);

// Without the option a rejection that gets its handler late makes native code call nothing of Bun's own JavaScript. The error is printed and the exit code set at the first report; immediates keep the loop alive behind it.
test("a handler that is laid late, without the option", async () => {
  using dir = tempDir("aot-option-of-the-run", {
    "tsconfig.json": "{}",
    "late.ts": `const lost = Promise.reject(new Error("made up"));
setImmediate(() => {
  lost.catch(error => console.log("caught", error.message));
  setImmediate(() => console.log("still here"));
});
console.log("ran");`,
  });
  const late = await build(String(dir), "late.ts");
  expect(await run(late, undefined)).toMatchObject({
    stdout: "ran\ncaught made up\nstill here\n",
    exitCode: 1,
    warnings: [],
  });
}, 240_000);
