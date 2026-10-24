// A module of Bun's library, internal/process/pre_execution, carries out --stack-trace-limit and the --trace options. The image of a compiled program has the
// modules that the program uses, so an executable does without that one: native code sets the limit as the module would, and the options that only print or write
// something for whoever started the program are ignored with a warning. A server starts, whatever its environment holds.
import { beforeAll, expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

setDefaultTimeout(120_000);

const countsFrames = `function depth(n) {
  if (n === 0) return (new Error("x").stack ?? "").split("\\n").length - 1;
  return depth(n - 1) + 0;
}
`;
const files = {
  "limit.js":
    countsFrames +
    `console.log(Error.stackTraceLimit, depth(30), JSON.stringify(process.execArgv), JSON.stringify(process.argv.slice(2)));\n`,
  "worker.js":
    `import { parentPort } from "node:worker_threads";\n` +
    countsFrames +
    `parentPort.postMessage(Error.stackTraceLimit + " " + depth(30));\n`,
  "workers.js": `import { Worker } from "node:worker_threads";
function start(execArgv) {
  return new Promise(resolve => {
    try {
      const worker = new Worker(new URL("./worker.js", import.meta.url), { execArgv });
      worker.on("message", message => resolve("answers " + message));
      worker.on("error", error => resolve("fails: " + error.message));
    } catch (error) {
      resolve("refused: " + error.code + ": " + error.message);
    }
  });
}
for (const execArgv of JSON.parse(process.argv[2])) console.log(JSON.stringify(execArgv), await start(execArgv ?? undefined));
console.log("here", Error.stackTraceLimit);
`,
  "exits.js": `console.log("ran", process.env.NOBODY_SETS_THIS);\nprocess.exit(0);\n`,
};

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined> = {}) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, ...env });
  return { stdout, stderr, exitCode };
}
const named = (name: string) => (isWindows ? name + ".exe" : name);
const building = (cwd: string, outfile: string, ...rest: string[]) =>
  run([bunExe(), "build", "--compile", "--aot", ...rest, "--outfile", named(outfile)], cwd);
async function build(...of: Parameters<typeof building>) {
  const built = await building(...of);
  expect(built.stderr).not.toMatch(/^error\b/m);
  expect(built.exitCode).toBe(0);
  return join(of[0], named(of[1]));
}
const ignored = (option: string) =>
  `warn: ${option} is ignored by this executable because it only runs code that was compiled into it. Rebuild it with --compile-inspector to load other code\n`;

describe("--stack-trace-limit works like in bun run", () => {
  const dir = tempDir("aot-options-of-the-library", files);
  const cwd = String(dir);
  let limit = "";
  let workers = "";
  beforeAll(async () => {
    [limit, workers] = await Promise.all([
      build(cwd, "limit", "limit.js"),
      build(cwd, "workers", "workers.js", "worker.js"),
    ]);
  });

  test.each([
    "--stack-trace-limit=3",
    "--stack-trace-limit 3",
    "--stack-trace-limit '3'",
    "--stack-trace-limit=abc",
    "--stack-trace-limit=0",
    "--stack-trace-limit=-1",
    "--stack-trace-limit=2.5",
    "--stack-trace-limit=1e2",
    "--stack-trace-limit=0x10",
    "--stack-trace-limit=Infinity",
    "--stack-trace-limit=",
    "--stack-trace-limit=3 --stack-trace-limit=5",
    "--stack-trace-limited=3",
    "--smol --stack-trace-limit=4",
    "--trace-event-categories --stack-trace-limit=4 --stack-trace-limit=6",
  ])("BUN_OPTIONS=%j", async options => {
    const expected = await run([bunExe(), "limit.js", "a"], cwd, { BUN_OPTIONS: options });
    expect(expected).toMatchObject({ stderr: "", exitCode: 0 });
    const ran = await run([limit, "a"], cwd, { BUN_OPTIONS: options });
    expect({ ...ran, stderr: ran.stderr.replace(ignored("--trace-event-categories"), "") }).toEqual(expected);
  });

  test("it sets the limit", async () => {
    expect(await run([limit], cwd, { BUN_OPTIONS: "--stack-trace-limit=3" })).toEqual({
      stdout: `3 3 ["--stack-trace-limit=3"] []\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test("behind the name of the executable it belongs to the program", async () => {
    expect(await run([limit, "--stack-trace-limit=3"], cwd)).toEqual({
      stdout: `10 10 [] ["--stack-trace-limit=3"]\n`,
      stderr: "",
      exitCode: 0,
    });
  });

  test.each(["--stack-trace-limit=3", "--stack-trace-limit 7", "--smol --stack-trace-limit=4"])(
    "--compile-exec-argv=%j",
    async options => {
      using own = tempDir("aot-options-of-the-library", files);
      const executable = await build(String(own), "limit", "--compile-exec-argv=" + options, "limit.js");
      expect(await run([executable, "a"], String(own))).toEqual(
        await run([bunExe(), ...options.split(" "), "limit.js", "a"], String(own)),
      );
    },
  );

  test("in the execArgv of a Worker, and inherited by one", async () => {
    const lists = JSON.stringify([
      null,
      [],
      ["--stack-trace-limit=3"],
      ["--no-addons", "--stack-trace-limit", "4"],
      ["--stack-trace-limit=x"],
      ["--title=x"],
      ["--trace-env-native-stack"],
    ]);
    for (const env of [{}, { BUN_OPTIONS: "--stack-trace-limit=6" }]) {
      const expected = await run([bunExe(), "workers.js", lists], cwd, env);
      expect({ ...expected }).toMatchObject({
        stdout: expect.stringContaining(`["--stack-trace-limit=3"] answers 3 3\n`),
        stderr: "",
        exitCode: 0,
      });
      expect(await run([workers, lists], cwd, env)).toEqual(expected);
    }
  });
});

describe("the options that print or write something for whoever started the program", () => {
  const dir = tempDir("aot-options-of-the-library", files);
  const cwd = String(dir);
  let exits = "";
  let workers = "";
  beforeAll(async () => {
    [exits, workers] = await Promise.all([
      build(cwd, "exits", "exits.js"),
      build(cwd, "workers", "workers.js", "worker.js"),
    ]);
  });

  test.each([
    ["--trace-exit", "--trace-exit"],
    ["--trace-env", "--trace-env"],
    ["--trace-env-js-stack", "--trace-env-js-stack"],
    ["--trace-events-enabled", "--trace-events-enabled"],
    ["--trace-event-categories", "--trace-event-categories node.perf"],
    ["--trace-event-categories", "--trace-event-categories=node.perf"],
    ["--trace-event-file-pattern", "--trace-event-file-pattern=mine.log"],
  ])("%s is ignored with a warning, and the program runs: BUN_OPTIONS=%j", async (option, options) => {
    expect(await run([exits], cwd, { BUN_OPTIONS: options })).toEqual({
      stdout: "ran undefined\n",
      stderr: ignored(option),
      exitCode: 0,
    });
  });

  test("one line for each", async () => {
    const ran = await run([exits], cwd, {
      BUN_OPTIONS: "--trace-exit --smol --trace-env --trace-exit --stack-trace-limit=3",
    });
    expect(ran).toEqual({
      stdout: "ran undefined\n",
      stderr: ignored("--trace-exit") + ignored("--trace-env"),
      exitCode: 0,
    });
  });

  test("--trace-env-native-stack does nothing in bun run either", async () => {
    const env = { BUN_OPTIONS: "--trace-env-native-stack" };
    expect(await run([exits], cwd, env)).toEqual({ stdout: "ran undefined\n", stderr: "", exitCode: 0 });
    expect(await run([bunExe(), "exits.js"], cwd, env)).toEqual({ stdout: "ran undefined\n", stderr: "", exitCode: 0 });
  });

  test("an option that loads code still ends the process", async () => {
    const ran = await run([exits], cwd, { BUN_OPTIONS: "--trace-exit --preload ./limit.js" });
    expect(ran).toEqual({
      stdout: "",
      stderr: expect.stringMatching(/^error: --preload can't be used with this executable/),
      exitCode: 1,
    });
  });

  test("in the execArgv of a Worker", async () => {
    const ran = await run([workers, JSON.stringify([["--trace-exit", "--stack-trace-limit=5"]])], cwd);
    expect(ran).toEqual({
      stdout: `["--trace-exit","--stack-trace-limit=5"] answers 5 5\nhere 10\n`,
      stderr: ignored("--trace-exit"),
      exitCode: 0,
    });
  });

  test("a build with --compile-inspector obeys them", async () => {
    using own = tempDir("aot-options-of-the-library", files);
    const executable = await build(String(own), "exits", "--compile-inspector", "exits.js");
    const ran = await run([executable], String(own), { BUN_OPTIONS: "--trace-exit" });
    expect(ran).toEqual({
      stdout: "ran undefined\n",
      stderr: expect.stringContaining("WARNING: Exited the environment with code 0\n"),
      exitCode: 0,
    });
  });

  test("in --compile-exec-argv they fail the build", async () => {
    using own = tempDir("aot-options-of-the-library", files);
    const built = await building(String(own), "exits", "--compile-exec-argv=--trace-exit", "exits.js");
    expect(built).toMatchObject({
      stderr: expect.stringContaining("error: --aot does not support --trace-exit in --compile-exec-argv"),
      exitCode: 1,
    });
  });
});
