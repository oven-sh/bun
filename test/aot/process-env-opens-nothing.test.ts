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
  "Object.getOwnPropertyDescriptor": `console.log(Object.getOwnPropertyDescriptor(process.env, "A"));`,
  "Object.hasOwn": `console.log(Object.hasOwn(process.env, "A"));`,
  // The trap `set` hands its receiver to Reflect.set, which asks the receiver by the traps getOwnPropertyDescriptor and defineProperty.
  "a store": `process.env.A = "b"; console.log(process.env.A);`,
  "a store where nothing is": `process.env.A ??= "b"; console.log(process.env.A);`,
  "Object.defineProperty": `Object.defineProperty(process.env, "A", { value: "b", writable: true, enumerable: true, configurable: true }); console.log(process.env.A);`,
  "JSON.stringify": `console.log(JSON.stringify(process.env).length > 2);`,
  "a method that every object inherits": `console.log(process.env.hasOwnProperty("A") === true);`,
};
// A copy, and a name of the command line, may hold or name whatever lies on Object.prototype and Function.prototype.
const handsOutWhatEveryObjectHas = {
  "a spread": `console.log({ ...process.env }.A);`,
  "a spread with a name beside it": `const env = { ...process.env, A: "b" }; console.log(env.A);`,
  "Object.assign": `console.log(Object.assign({}, process.env).A);`,
  "a read under a name of the command line": `console.log(process.env[process.argv[2] ?? "A"]);`,
  "a store under a name of the command line": `const name = process.argv[2] ?? "A"; process.env[name] = "b"; console.log(process.env[name]);`,
};
// TODO: windowsEnv lays a printer under Bun.inspect.custom on the target, and the formatter hands such a printer util.inspect.
const openOnWindows = {
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
  const names = lines.flatMap(line => /trim: uses (.*) \(escapes, so any member may be used\)$/.exec(line)?.[1] ?? []);
  // On Windows the trap defineProperty throws errors with a code of Node's. Native code makes them, of any class of errors.
  return names.filter(name => !name.endsWith("Error.prototype") && name !== "Function.prototype");
}

// `console` escapes wherever a program prints, and a listing hands out one object more.
const few = 2;

for (const [what, text] of Object.entries(closed))
  test.concurrent(`${what} lets nothing more escape`, async () => {
    const names = await escaped(text);
    expect(names).not.toContain("globalThis");
    expect(names.length).toBeLessThanOrEqual(few);
  });

for (const [what, text] of Object.entries(handsOutWhatEveryObjectHas))
  test.concurrent(`${what} lets no more escape than every object has`, async () => {
    const names = await escaped(text);
    expect(names).not.toContain("globalThis");
    expect(names.length).toBeLessThanOrEqual(20);
  });

for (const [what, text] of Object.entries(openOnWindows))
  (isWindows ? test.todo : test.concurrent)(`${what} lets nothing more escape`, async () => {
    const names = await escaped(text);
    expect(names).not.toContain("globalThis");
    expect(names.length).toBeLessThanOrEqual(few);
  });
