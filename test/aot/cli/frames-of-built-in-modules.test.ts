// docs/compiler/debugging.mdx, "Minified executables and external source maps": a frame of the program points into compiled.js and has no
// name, a frame of a built-in module keeps its name and its file. agent-base finds node:https in the stack.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { built, slot, spawned } from "../harness/commands";
import { describe, test } from "../supported";

const env = { ...bunEnv, NO_COLOR: "1" };
const buildLimit = 300_000;

const program = {
  "app-of-the-test.ts": `import { EventEmitter } from "node:events";
import { throwOfTheTest } from "./module-of-the-test";
class EmitterOfTheTest extends EventEmitter {}
const emitter = new EmitterOfTheTest();
emitter.on("stack", function listenerOfTheTest() {
  throwOfTheTest(process.argv.length);
});
function callerOfTheTest() {
  emitter.emit("stack");
}
for (const show of [(error: any) => error.stack, (error: any) => Bun.inspect(error)]) {
  try {
    callerOfTheTest();
  } catch (error) {
    console.log(show(error));
  }
}
Error.prepareStackTrace = (error, sites) => sites.map(site => "    at " + site.getFunctionName() + " (" + site.getFileName() + ":" + site.getLineNumber() + ":" + site.getColumnNumber() + ")").join("\\n");
try {
  callerOfTheTest();
} catch (error) {
  console.log((error as Error).stack);
}
`,
  "module-of-the-test.ts": `export function throwOfTheTest(depth: number): number {
  if (depth > 0) throw new Error("too deep");
  return depth;
}
`,
};

describe.concurrent("frames of built-in modules", () => {
  for (const flags of [["--sourcemap=external"], ["--minify", "--sourcemap=external"], ["--obfuscate"]]) {
    test(
      flags.join(" "),
      () =>
        slot(async () => {
          using dir = tempDir("frames-of-built-in-modules", program);
          const folder = String(dir);
          built(await spawned([bunExe(), "compile", "app-of-the-test.ts", "--outfile", "app", ...flags], folder, env));
          const { stdout, exitCode } = await spawned([join(folder, isWindows ? "app.exe" : "app")], folder, env);
          expect(stdout).not.toContain("OfTheTest");
          expect(stdout).not.toContain("of-the-test");
          const frames = stdout
            .split("\n")
            .flatMap(line => /^\s+at (.*)$/.exec(line)?.[1].replace(/:\d+:\d+/, "") ?? []);
          const emit = "emit (node:events)";
          expect(frames.filter(frame => frame === emit)).toEqual([emit, emit, emit]);
          const ofProgram = /^(?:(?:<anonymous>|null|) \((?:.*[\\/])?compiled\.js\)|(?:.*[\\/])?compiled\.js)$/;
          expect(frames.filter(frame => frame !== emit && !ofProgram.test(frame))).toEqual([]);
          expect(exitCode).toBe(0);
        }),
      buildLimit,
    );
  }
});
