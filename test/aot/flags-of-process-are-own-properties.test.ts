import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const head = `
  import { EventEmitter } from "node:events";
  import util from "node:util";
  process.on("warning", warning => console.log("warned", warning.name));
`;
const tail = `
  util.deprecate(() => {}, "x")();
  process.emitWarning("y", "DeprecationWarning");
  await new Promise(resolve => setTimeout(resolve, 10));
  console.log("done");
`;
const warned = "warned DeprecationWarning\nwarned DeprecationWarning\ndone\n";
const env = { ...bunEnv, NODE_NO_WARNINGS: "1" };

async function run(cmd: string[], cwd: string) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, env);
  return { stdout, stderr, exitCode };
}

async function plainlyAndCompiled(text: string, option?: string) {
  using dir = tempDir("aot-flags-of-process", { "main.mjs": head + text + tail });
  const plainly = await run([bunExe(), ...(option ? [option] : []), "main.mjs"], String(dir));
  const executable = join(String(dir), "main" + (isWindows ? ".exe" : ""));
  const built = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      ...(option ? ["--compile-exec-argv=" + option] : []),
      "main.mjs",
      "--outfile",
      executable,
    ],
    String(dir),
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
  const compiled = await run([executable], String(dir));
  return { plainly: plainly.stdout, compiled: compiled.stdout, exitCodes: [plainly.exitCode, compiled.exitCode] };
}

test.concurrent.each([
  ["nothing is said", ``, undefined, warned],
  ["process.noDeprecation is stored", `process.noDeprecation = true;`, undefined, "done\n"],
  [
    "process.noDeprecation is defined",
    `Object.defineProperty(process, "noDeprecation", { value: true });`,
    undefined,
    "done\n",
  ],
  ["--no-deprecation is given", ``, "--no-deprecation", "done\n"],
])(
  "a compiled program warns as Bun does where %s",
  async (_, text, option, stdout) => {
    expect(await plainlyAndCompiled(text, option)).toEqual({ plainly: stdout, compiled: stdout, exitCodes: [0, 0] });
  },
  240_000,
);

test.concurrent.each([
  ["a value", `EventEmitter.prototype.noDeprecation = true;`, "done\n"],
  [
    "an accessor",
    `Object.defineProperty(EventEmitter.prototype, "noDeprecation", { get() { console.log("asked", this === process); return true; } });`,
    "asked true\nasked true\ndone\n",
  ],
])(
  "a compiled program finds noDeprecation on what process inherits from, as Bun does: %s",
  async (_, text, stdout) => {
    expect(await plainlyAndCompiled(text)).toEqual({ plainly: stdout, compiled: stdout, exitCodes: [0, 0] });
  },
  240_000,
);
