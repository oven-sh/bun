// A listener that native code calls for the program (dispatchEvent(), process.emit(), abort()) throws an error that was made earlier.
// Native code takes that error and reports it as uncaught. The catch block around the call never gets it, so the report names the
// place of the throw, as under plain Bun, and not the place where the error was made.
import { expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, spawned, withoutDebugInformation } from "./harness/commands";
import { afterAll } from "./harness/default-timeout";
import { beforeAll, describe, test } from "./supported";

const program = `
function make(message) {
  return new Error(message);
}
const made = make("made earlier");
function listener() {
  throw made;
}
const calls = {
  dispatchEvent() {
    const target = new EventTarget();
    target.addEventListener("event", listener);
    return () => target.dispatchEvent(new Event("event"));
  },
  emit() {
    process.on("event", listener);
    return () => process.emit("event");
  },
  abort() {
    const controller = new AbortController();
    controller.signal.addEventListener("abort", listener);
    return () => controller.abort();
  },
};
const call = calls[process.argv[2]]();
try {
  call();
} catch {
  console.log("the caller caught it");
}
console.log("after the call");
`;

describe("compile/aot/an older error that a listener throws is reported where it was thrown", () => {
  const folder = String(tempDir("aot-a-listener-throws-an-older-error", { "program.js": program }));
  afterAll(() => rmSync(folder, { recursive: true, force: true }));
  const executable = join(folder, isWindows ? "program.exe" : "program");

  beforeAll(async () => {
    built(
      await spawned(
        [
          bunExe(),
          "build",
          "--compile",
          "--aot",
          ...withoutDebugInformation(),
          join(folder, "program.js"),
          "--outfile",
          executable,
        ],
        folder,
        bunEnv,
      ),
    );
  }, 300_000);

  // The frames of a stack trace are not held to plain Bun line by line. The function that the first one names is.
  const firstFrame = (stderr: string) => /^\s+at (\S+)/m.exec(stderr)?.[1];

  test.each(["dispatchEvent", "emit", "abort"])("%s()", async site => {
    const [compiled, plain] = await Promise.all([
      spawned([executable, site], folder, bunEnv),
      spawned([bunExe(), join(folder, "program.js"), site], folder, bunEnv),
    ]);
    const told = (run: typeof compiled) => ({
      stdout: run.stdout,
      report: run.stderr.split("\n").find(line => line.startsWith("error")),
      firstFrame: firstFrame(run.stderr),
      signal: run.signal,
    });
    expect(told(compiled)).toEqual({
      stdout: "after the call\n",
      report: "error: made earlier",
      firstFrame: "listener",
      signal: null,
    });
    expect(told(compiled)).toEqual(told(plain));
  });
});
