import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

// A compiled program takes the members of built-in objects that it uses for constants. Most of those objects are created at their first read, not at start-up,
// and they are locked at that moment: a write that comes before the program's first use of the object is refused like one that comes after it.

const program = `
function relies() {
  return [
    Date.now() > 0,
    Math.floor(1.5),
    JSON.stringify(1),
    WebAssembly.validate(new Uint8Array(0)),
    new Intl.NumberFormat("en").format(1),
    performance.now() >= 0,
    new TextEncoder().encode("a").length,
    crypto.randomUUID().length,
    new AbortController().signal.aborted,
    typeof Bun.hash("a"),
    Reflect.ownKeys({}).length,
    Atomics.load(new Int32Array(1), 0),
    new URLSearchParams("a=1").get("a"),
    Buffer.byteLength("a"),
    typeof process.hrtime.bigint(),
    structuredClone(1),
    Number.parseFloat("1.5"),
    Object.keys({ a: 1 }).length,
    Array.isArray([]),
    String.fromCharCode(65),
    Symbol.for("a").description,
    Promise.resolve(1) instanceof Promise,
    new Intl.DateTimeFormat("en").resolvedOptions().locale,
    new Headers({ a: "1" }).get("a"),
    new URL("http://a/b").pathname,
    Bun.inspect(1),
    new TextDecoder().decode(new Uint8Array([65])),
  ].join(" ");
}
const paths = [
  "Date.now", "Math.floor", "JSON.stringify", "WebAssembly.validate", "Intl.NumberFormat", "Intl.NumberFormat.prototype.format", "performance.now", "TextEncoder.prototype.encode",
  "crypto.randomUUID", "AbortController.prototype.abort", "Bun.hash", "Reflect.ownKeys", "Atomics.load", "URLSearchParams.prototype.get", "Buffer.byteLength", "process.hrtime", "process.hrtime.bigint",
  "Number.parseFloat", "Object.keys", "Array.isArray", "String.fromCharCode", "Symbol.for", "Promise.resolve", "Intl.DateTimeFormat", "Intl.DateTimeFormat.prototype.resolvedOptions",
  "Headers.prototype.get", "URL.prototype.pathname", "Bun.inspect", "TextDecoder.prototype.decode", "WebAssembly", "Intl", "performance", "crypto", "Bun", "process", "TextEncoder", "structuredClone",
];
if (process.argv[2] === "use-first") relies();
for (const path of paths) {
  const names = path.split(".");
  const last = names.pop();
  let holder = globalThis;
  for (const name of names) holder = holder[name];
  const before = Object.getOwnPropertyDescriptor(holder, last);
  let outcome = "assigned";
  try {
    holder[last] = 1;
    if (holder[last] !== 1) outcome = "ignored";
  } catch (error) {
    outcome = error.name;
  }
  if (outcome === "assigned") before ? Object.defineProperty(holder, last, before) : delete holder[last];
  let defined = "defined";
  try {
    Object.defineProperty(holder, last, { value: 2, configurable: true, writable: true });
  } catch (error) {
    defined = error.name;
  }
  if (defined === "defined") before ? Object.defineProperty(holder, last, before) : delete holder[last];
  console.log(path, outcome, defined);
}
console.log(relies());
`;

const createdAtFirstRead = [
  "Intl.NumberFormat.prototype.format",
  "Intl.DateTimeFormat.prototype.resolvedOptions",
  "TextEncoder.prototype.encode",
  "TextDecoder.prototype.decode",
  "Reflect.ownKeys",
  "Atomics.load",
];

// These are constants only in a program that does not write them. This one may write any member of any object that it reaches from the global object.
const openBecauseTheProgramWritesThem = [
  "WebAssembly.validate",
  "Intl.NumberFormat",
  "performance.now",
  "process.hrtime",
];

test("a write is refused before the program's first use of a built-in object as it is after it", async () => {
  using dir = tempDir("built-ins-created-late", { "main.mjs": program });
  const cwd = String(dir);
  const { stderr, exitCode: buildExitCode } = await runCommand(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "program"],
    cwd,
    { ...bunEnv, NO_COLOR: "1" },
  );
  expect({ stderr, exitCode: buildExitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
  const run = async (...args: string[]) => {
    const { stdout, exitCode } = await runCommand([join(cwd, "program"), ...args], cwd);
    expect(exitCode).toBe(0);
    return stdout.trim().split("\n");
  };
  const writesFirst = await run();
  expect(writesFirst).toEqual(await run("use-first"));
  expect(writesFirst).toEqual(expect.arrayContaining(createdAtFirstRead.map(path => `${path} TypeError TypeError`)));
  expect(writesFirst).toEqual(
    expect.arrayContaining(openBecauseTheProgramWritesThem.map(path => `${path} assigned defined`)),
  );
  expect(writesFirst.at(-1)).toBe(
    "true 1 1 false 1 true 1 36 false bigint 0 0 1 1 bigint 1 1.5 1 true A a true en 1 /b 1 A",
  );
}, 120_000);
