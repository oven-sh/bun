// A function of a node:vm context has the engine's own Error.captureStackTrace, which keeps its frames apart from the ones that Bun formats.
// The collection that finds one of those frames dead writes the stack out by itself, and may look into no realm for a name. Compiled code that
// calls `require` lists the function that `require` hands the file to. Its frame has the name of that function object: "anonymous" for a
// CommonJS file, none for an ES module.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";

const files = {
  "main.cjs": `const vm = require("node:vm");
const context = vm.createContext({});
const kept = { common: [], module: [] };
globalThis.keep = function keep(from) {
  const error = new Error("kept");
  const capture = vm.runInContext("(function (error) { Error.captureStackTrace(error); })", context);
  // This function is on the stack that is captured, and dies with the call.
  new Function("capture", "error", "capture(error);")(capture, error);
  kept[from].push(error);
};
require("./common.cjs");
require("./module.mjs");
const listed = error =>
  error.stack
    .split("\\n")
    .map(line => line.slice(0, line.indexOf("@")))
    .join(" < ");
const atOnce = { common: listed(kept.common[0]), module: listed(kept.module[0]) };
console.log(JSON.stringify(atOnce.common));
console.log(JSON.stringify(atOnce.module));
Bun.gc(true);
for (const from of ["common", "module"])
  console.log(from, kept[from].filter(error => listed(error) === atOnce[from]).length, "of", kept[from].length);
`,
  "common.cjs": `for (let i = 0; i < 20; ++i) globalThis.keep("common");\n`,
  "module.mjs": `for (let i = 0; i < 20; ++i) globalThis.keep("module");\nexport {};\n`,
};

// Not every build of Bun includes the compiler. One without it says so before it looks for the entry point.
const unsupported = /^error: --aot (?:only supports|isn't available) /m.test(
  Bun.spawnSync({
    cmd: [bunExe(), "build", "--compile", "--aot", "./no-such-file.ts"],
    cwd: import.meta.dir,
    env: bunEnv,
    stdout: "ignore",
    stderr: "pipe",
  }).stderr.toString(),
);

test.skipIf(unsupported)(
  "a captured stack below require reads the same after a collection has written it out",
  async () => {
    using dir = tempDir("aot-captured-stack-below-require", files);
    const folder = String(dir);
    const executable = join(folder, "main");
    {
      await using build = Bun.spawn({
        cmd: [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
        cwd: folder,
        env: bunEnv,
        stdout: "ignore",
        stderr: "pipe",
      });
      const [stderr, exitCode] = await Promise.all([build.stderr.text(), build.exited]);
      expect({ stderr, exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
    }
    await using ran = Bun.spawn({
      cmd: [executable],
      cwd: folder,
      env: { ...bunEnv, BUN_ENABLE_CRASH_REPORTING: "0" },
      stdout: "pipe",
      stderr: "ignore",
    });
    const [stdout, exitCode] = await Promise.all([ran.stdout.text(), ran.exited]);
    expect({ stdout, exitCode, signal: ran.signalCode }).toEqual({
      // The function of the context, the one that dies, keep(), the body of the required file, the function that require called, the body of main.cjs.
      stdout: [
        '" < anonymous < keep <  < anonymous < "',
        '" < anonymous < keep < module code <  < "',
        "common 20 of 20",
        "module 20 of 20",
        "",
      ].join("\n"),
      exitCode: 0,
      signal: null,
    });
  },
  600_000,
);
