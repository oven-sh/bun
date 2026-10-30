// On Windows process.env is a Proxy that Bun's own code makes (windowsEnv in src/js/builtins/ProcessObjectInternals.ts), so there
// the compiler follows a proxy where other systems have an object of the host. What a program does to process.env is no use of
// every built-in on any of them.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { test } from "./supported";

const closed = {
  "the descriptor of process": `console.log(typeof Object.getOwnPropertyDescriptor(globalThis, "process").value.report);`,
  "a read": `console.log(process.env.HOME);`,
  "a delete": `delete process.env.A; console.log(process.env.A);`,
  "in and Object.keys": `console.log("A" in process.env, Object.keys(process.env).length > 0);`,
  "Object.entries": `console.log(Object.entries(process.env).length > 0);`,
  "for-in": `for (const name in process.env) console.log(name);`,
};
// TODO: the trap `set` hands its receiver to Reflect.set, and these hand the proxy itself to a built-in: the compiler then takes the
// traps to be called by anybody with anything. It has to ask the traps getOwnPropertyDescriptor and defineProperty instead.
const openOnWindows = {
  "a store": `process.env.A = "b"; console.log(process.env.A);`,
  "a store where nothing is": `process.env.A ??= "b"; console.log(process.env.A);`,
  "Object.defineProperty": `Object.defineProperty(process.env, "A", { value: "b", writable: true, enumerable: true, configurable: true }); console.log(process.env.A);`,
  "Object.getOwnPropertyDescriptor": `console.log(Object.getOwnPropertyDescriptor(process.env, "A"));`,
  "JSON.stringify": `console.log(JSON.stringify(process.env).length > 2);`,
  "console.log": `console.log(process.env);`,
};

async function escaped(text: string) {
  using dir = tempDir("aot-process-env", { "main.js": text });
  await using proc = Bun.spawn({
    cmd: [bunExe(), "check", "--aot", "--no-pretty", "--explain=trim", "main.js"],
    cwd: String(dir),
    env: { ...bunEnv, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  const lines = (stdout + stderr).split("\n");
  expect(lines).toContain("aot: trim: the compiler can see every API this program uses");
  return lines.flatMap(line => /trim: uses (.*) \(escapes, so any member may be used\)$/.exec(line)?.[1] ?? []);
}

// `console` escapes wherever a program prints, and a listing hands out one object more.
const few = 2;

for (const [what, text] of Object.entries(closed))
  test.concurrent(`${what} lets nothing more escape`, async () => {
    const names = await escaped(text);
    expect(names).not.toContain("globalThis");
    expect(names.length).toBeLessThanOrEqual(few);
  });

for (const [what, text] of Object.entries(openOnWindows))
  (isWindows ? test.todo : test.concurrent)(`${what} lets nothing more escape`, async () => {
    const names = await escaped(text);
    expect(names).not.toContain("globalThis");
    expect(names.length).toBeLessThanOrEqual(few);
  });
