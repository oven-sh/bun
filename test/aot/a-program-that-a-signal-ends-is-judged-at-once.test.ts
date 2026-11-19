// run-parallel.ts says which signal ended a program, with what the program had printed, and does not wait for its time limit to say so.
// No `// Todo` stands for that: a mark says that a program answers otherwise than its reference, not that it dies.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { spawned } from "./harness/commands";
import { run } from "./harness/run";
import { handsCoresToAProgram } from "./harness/without-core-dump";
import { test } from "./supported";

const isCanary = Bun.spawnSync([bunExe(), "--revision"]).stdout.toString().includes("-canary");

test.skipIf(isWindows)("so is a command of a test", async () => {
  const says = [
    `const limits = require("fs").existsSync("/proc/self/limits") ? require("fs").readFileSync("/proc/self/limits", "utf8") : "Max core file size 0";`,
    `console.log(Number(/^Max core file size +(\\S+)/m.exec(limits)[1]) <= 1, process.env.BUN_ENABLE_CRASH_REPORTING);`,
  ].join("\n");
  const env = { ...bunEnv, BUN_CRASH_REPORT_URL: undefined, BUN_ENABLE_CRASH_REPORTING: undefined };
  for (const start of [run, spawned]) {
    const { stdout, exitCode } = await start([bunExe(), "-e", says], import.meta.dir, env);
    const [hasNoCoreDump, sendsAReport] = stdout.trim().split(" ");
    expect({ hasNoCoreDump: hasNoCoreDump === "true" || !handsCoresToAProgram, sendsAReport, exitCode }).toEqual({
      hasNoCoreDump: true,
      sendsAReport: "0",
      exitCode: 0,
    });
  }
});

test.skipIf(isWindows)("a command is started where the limit is nothing and may not be raised", async () => {
  const starts = [
    `import { withoutCoreDump } from ${JSON.stringify(join(import.meta.dir, "harness", "without-core-dump.ts"))};`,
    `const { stdout, exitCode } = Bun.spawnSync(withoutCoreDump(withoutCoreDump(["echo", "started"])));`,
    `console.log(stdout.toString().trim(), exitCode);`,
  ].join("\n");
  const cmd = ["/bin/sh", "-c", `ulimit -c 0 && exec "$@"`, "--", bunExe(), "-e", starts];
  expect(await run(cmd, import.meta.dir, bunEnv)).toMatchObject({ stdout: "started 0\n", exitCode: 0 });
});

test.skipIf(isWindows || !isCanary)(
  "a program that a signal ends is judged at once",
  async () => {
    using dir = tempDir("a-program-that-a-signal-ends", {
      "tsconfig.json": "{}",
      "aborts.js": `console.error("said before the end");\nprocess.abort();\n`,
      "aborts-under-a-todo.js": `// Todo: "true" | "false": some day\nconsole.error("said before the end");\nprocess.abort();\n`,
      "aborts-under-a-todo-of-one-way.js": [
        `// Under: --define DIES=true: the build whose executable dies`,
        `// Todo under --define DIES=true: "true" | "false": some day`,
        `if (typeof DIES !== "undefined") process.abort();`,
        `console.log(true);`,
        `/* Output:`,
        `true`,
        `*/\n`,
      ].join("\n"),
      "faults-under-a-todo.js": `// Todo: "true" | "false": some day\nconsole.error("said before the end");\nprocess.kill(process.pid, "SIGSEGV");\nawait Bun.sleep(200_000);\n`,
      "answers-otherwise-under-a-todo.js": `// Todo: "true" | "false": some day\nconsole.log(true);\n/* Output:\nfalse\n*/\n`,
      // The command outlives the time limit of a run, in the group of the program and with its pipe for errors.
      "leaves-a-command-behind.js": [
        `Bun.spawnSync({ cmd: ["sh", "-c", "sleep 200 &"], stdio: ["ignore", "ignore", "inherit"] });`,
        `console.error("said before the end");`,
        `process.kill(process.pid, "SIGKILL");`,
        `await Bun.sleep(200_000);\n`,
      ].join("\n"),
      "says-what-it-may-do.js": [
        `import { existsSync, readFileSync } from "node:fs";`,
        `const limits = existsSync("/proc/self/limits") ? readFileSync("/proc/self/limits", "utf8") : "Max core file size 0";`,
        `console.log("a core dump of at most a byte:", Number(/^Max core file size +(\\S+)/m.exec(limits)[1]) <= 1);`,
        `console.log("sends a report:", process.env.BUN_ENABLE_CRASH_REPORTING !== "0");`,
        `/* Output:`,
        `a core dump of at most a byte: true`,
        `sends a report: false`,
        `*/\n`,
      ].join("\n"),
    });
    const root = String(dir);
    const files = [
      "aborts.js",
      "aborts-under-a-todo.js",
      "aborts-under-a-todo-of-one-way.js",
      "faults-under-a-todo.js",
      "answers-otherwise-under-a-todo.js",
      "leaves-a-command-behind.js",
      "says-what-it-may-do.js",
    ].map(name => join(root, name));
    const { stdout, exitCode } = await run(
      [bunExe(), join(import.meta.dir, "run-parallel.ts"), `--root=${root}`, "--jobs=3", "--seconds=180", ...files],
      root,
      { ...bunEnv, BUN_CRASH_REPORT_URL: undefined, BUN_ENABLE_CRASH_REPORTING: undefined },
    );
    const verdicts = stdout
      .split("\n")
      .filter(Boolean)
      .map(line => JSON.parse(line))
      .filter(({ state }) => state !== "compiling")
      .map(({ file, state, stage, message, actual }) => ({
        file: file.slice(root.length + 1),
        state,
        stage,
        message,
        said: actual?.stderr.includes("said before the end"),
      }))
      .sort((a, b) => a.file.localeCompare(b.file));
    const ofOneWay = "under --define DIES=true: it ended by SIGABRT";
    expect(verdicts).toEqual([
      { file: "aborts-under-a-todo-of-one-way.js", state: "fail", stage: "run", message: ofOneWay, said: false },
      { file: "aborts-under-a-todo.js", state: "fail", stage: "run", message: "it ended by SIGABRT", said: true },
      { file: "aborts.js", state: "fail", stage: "run", message: "it ended by SIGABRT", said: true },
      {
        file: "answers-otherwise-under-a-todo.js",
        state: "skip",
        stage: undefined,
        message: 'todo: "true" | "false": some day',
        said: undefined,
      },
      { file: "faults-under-a-todo.js", state: "fail", stage: "run", message: "it ended by SIGSEGV", said: true },
      { file: "leaves-a-command-behind.js", state: "fail", stage: "run", message: "it ended by SIGKILL", said: true },
      { file: "says-what-it-may-do.js", state: "pass", stage: undefined, message: undefined, said: undefined },
    ]);
    expect(exitCode).toBe(1);
  },
  // Less than the limit of a run that the driver is given above, which is less than what the programs sleep.
  // The nine builds take 4 s on an arm64 Mac and 52 to 80 s on an Intel Mac.
  170_000,
);
