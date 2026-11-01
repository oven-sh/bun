// In Bun's own code a bare `setTimeout` or `Blob` is what Bun began with, as in Node: plain Bun reads `@natives.setTimeout` there (`nativeFunctions` and `nativeGlobals` of
// src/codegen/replacements.ts). What a test puts on `globalThis` in its place is called by the test's own code and by no built-in module.
// Compiled, that code read the name off the global object wherever a test of the run, or a file of an executable, stores to it. The manifest of Bun's own code now lists the
// names for the compiler.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
// One by one: a case builds for minutes, and beside others it would pass its limit where Bun has a sanitizer.
import { testOneByOne as test } from "./supported";

const classes = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "a.test.js": `import { test } from "bun:test";
import { Readable } from "node:stream";
import { blob, text } from "node:stream/consumers";
import { pathToFileURL } from "node:url";
test("classes", async () => {
  const made = [];
  const real = { Blob, URL, TextDecoder };
  globalThis.Blob = class extends real.Blob { constructor(...operands) { super(...operands); made.push("Blob"); } };
  globalThis.URL = class extends real.URL { constructor(...operands) { super(...operands); made.push("URL"); } };
  globalThis.TextDecoder = class extends real.TextDecoder { constructor(...operands) { super(...operands); made.push("TextDecoder"); } };
  try {
    console.log("SEEN", await text(Readable.from([Buffer.from("a"), Buffer.from("b")])), (await blob(Readable.from([Buffer.from("abc")]))).size, pathToFileURL("/a/b").protocol);
    console.log("SEEN the library", made.sort().join());
    new URL("http://a");
    new Blob([]);
    console.log("SEEN with the project's own", made.sort().join());
  } finally {
    Object.assign(globalThis, real);
  }
});
`,
};

const files = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "uses.js": `export const own = () => { clearTimeout(setTimeout(() => {}, 1)); queueMicrotask(() => {}); };\n`,
  "a.test.js": `import { test } from "bun:test";
import { execFile } from "node:child_process";
import net from "node:net";
import { Readable } from "node:stream";
import { own } from "./uses.js";
test("timers", async () => {
  const called = [];
  const real = { setTimeout, setInterval, setImmediate, clearTimeout, clearInterval, clearImmediate, queueMicrotask };
  globalThis.setTimeout = (...operands) => { called.push("setTimeout " + operands[1]); return real.setTimeout(...operands); };
  globalThis.setInterval = (...operands) => { called.push("setInterval"); return real.setInterval(...operands); };
  globalThis.setImmediate = (...operands) => { called.push("setImmediate"); return real.setImmediate(...operands); };
  globalThis.clearTimeout = timer => { called.push("clearTimeout"); real.clearTimeout(timer); };
  globalThis.clearInterval = timer => { called.push("clearInterval"); real.clearInterval(timer); };
  globalThis.clearImmediate = timer => { called.push("clearImmediate"); real.clearImmediate(timer); };
  globalThis.queueMicrotask = callback => { called.push("queueMicrotask"); real.queueMicrotask(callback); };
  try {
    await new Promise(resolve => execFile(${isWindows ? `"cmd", ["/c", "exit"]` : `"true", []`}, { timeout: 54321 }, resolve));
    const socket = new net.Socket();
    socket.setTimeout(4321);
    socket.setTimeout(0);
    socket.destroy();
    for await (const chunk of Readable.from(["a", "b"])) void chunk;
    console.log("SEEN the library", [...new Set(called)].sort().join());
    own();
    console.log("SEEN with the project's own calls", [...new Set(called)].sort().join());
  } finally {
    Object.assign(globalThis, real);
  }
});
`,
};

async function runTests(directory: string, words: string | undefined, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  return {
    stdout: stdout.split("\n").filter(line => line.startsWith("SEEN")),
    results: [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`),
    exitCode,
  };
}

test("what a test puts in the place of a timer is called by the project's code and by no built-in module", async () => {
  using dir = tempDir("aot-the-library-calls-native-timers", files);
  const plain = await runTests(String(dir), undefined);
  expect(plain).toEqual({
    stdout: ["SEEN the library ", "SEEN with the project's own calls clearTimeout,queueMicrotask,setTimeout 1"],
    results: ["pass timers"],
    exitCode: 0,
  });
  const [oneProgram, layers] = await Promise.all([
    runTests(String(dir), undefined, "--aot"),
    runTests(String(dir), "TestRunLayers:2", "--aot"),
  ]);
  expect(oneProgram).toEqual(plain);
  expect(layers).toEqual(plain);
}, 240_000);

test("a class that a test puts in the place of a global one is made by the project's code and by no built-in module", async () => {
  using dir = tempDir("aot-the-library-makes-native-classes", classes);
  const plain = await runTests(String(dir), undefined);
  expect(plain).toEqual({
    stdout: ["SEEN ab 3 file:", "SEEN the library ", "SEEN with the project's own Blob,URL"],
    results: ["pass classes"],
    exitCode: 0,
  });
  const [oneProgram, layers] = await Promise.all([
    runTests(String(dir), undefined, "--aot"),
    runTests(String(dir), "TestRunLayers:2", "--aot"),
  ]);
  expect(oneProgram).toEqual(plain);
  expect(layers).toEqual(plain);
}, 240_000);

// `crypto` is an object of the table, so Bun's own code names the object itself, whatever stands on the global object and from when:
// ./parallel/host-objects/crypto-stored-first.js, and webcrypto-is-the-global-crypto.cjs for the other name of it.
const stubbed = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "a.test.js": `import { test, vi } from "bun:test";
import node from "node:crypto";
test("crypto", () => {
  vi.stubGlobal("crypto", { randomUUID: () => "fixed" });
  console.log("SEEN", crypto.randomUUID(), node.getRandomValues(new Uint8Array(2)).length, typeof node.webcrypto.subtle, typeof node.subtle, node.randomUUID().length);
  vi.unstubAllGlobals();
});
`,
};

test("a test that stubs the global crypto leaves node:crypto whole", async () => {
  using dir = tempDir("aot-the-library-reads-the-native-crypto", stubbed);
  const plain = await runTests(String(dir), undefined);
  expect(plain).toEqual({ stdout: ["SEEN fixed 2 object object 36"], results: ["pass crypto"], exitCode: 0 });
  const [oneProgram, layers] = await Promise.all([
    runTests(String(dir), undefined, "--aot"),
    runTests(String(dir), "TestRunLayers:2", "--aot"),
  ]);
  expect(oneProgram).toEqual(plain);
  expect(layers).toEqual(plain);
}, 240_000);

const programs = {
  // A polyfill, instrumentation, a clock of the program's own.
  "by-name.mjs": `import net from "node:net";
import { pathToFileURL } from "node:url";
const called = [];
const real = { setTimeout, clearTimeout, URL };
globalThis.setTimeout = () => { called.push("setTimeout"); return 7; };
globalThis.clearTimeout = () => { called.push("clearTimeout"); };
globalThis.URL = undefined;
const socket = new net.Socket();
socket.setTimeout(1000);
console.log(typeof socket.timeout, pathToFileURL("/a").protocol, "the library called", called.join());
socket.destroy();
console.log(setTimeout(() => {}, 1), typeof URL, "the program called", called.join());
Object.assign(globalThis, real);
`,
  "by-a-name-that-nobody-reads.mjs": `import net from "node:net";
import { text } from "node:stream/consumers";
import { Readable } from "node:stream";
const called = [];
const real = { setTimeout, clearTimeout, TextDecoder };
for (const name of Object.keys(real)) globalThis[name] = function () { called.push(name); return 7; };
const socket = new net.Socket();
socket.setTimeout(1000);
console.log(typeof socket.timeout, await text(Readable.from([Buffer.from("ab")])), "the library called", called.join());
socket.destroy();
console.log(setTimeout(() => {}, 1), "the program called", called.join());
for (const name of Object.keys(real)) globalThis[name] = real[name];
`,
};

test.each(Object.keys(programs))(
  "an executable that stores to the globals itself, %s",
  async name => {
    using dir = tempDir("aot-the-library-of-an-executable-keeps-its-natives", programs);
    const executable = join(String(dir), "program" + (isWindows ? ".exe" : ""));
    const plain = await run([bunExe(), name], String(dir));
    expect({ ...plain, stdout: plain.stdout.split("\n") }).toMatchObject({
      stdout: [
        expect.stringMatching(/ the library called $/),
        expect.stringMatching(/^7 .*the program called setTimeout$/),
        "",
      ],
      exitCode: 0,
    });
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", `./${name}`, "--outfile", executable],
      String(dir),
    );
    expect({
      errors: build.stderr.split("\n").filter(line => line.startsWith("error")),
      exitCode: build.exitCode,
    }).toEqual({
      errors: [],
      exitCode: 0,
    });
    const compiled = await run([executable], String(dir));
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  },
  240_000,
);

// Compiled code called the timers directly, so under fake timers the functions themselves asked the fake clock, whoever called them. For the build a call of useFakeTimers()
// is now a store to the names that it fakes: test/aot/fake-timers-replace-the-globals.test.ts.
const faked = {
  "package.json": `{ "name": "p", "type": "module" }`,
  "a.test.js": `import { afterEach, jest, test } from "bun:test";
import { once } from "node:events";
import net from "node:net";
afterEach(() => jest.useRealTimers());
test("a socket's own timeout fires without a tick of the clock", async () => {
  jest.useFakeTimers();
  const server = net.createServer(() => {});
  server.listen(0);
  await once(server, "listening");
  const socket = net.connect(server.address().port);
  socket.setTimeout(30);
  await once(socket, "timeout");
  socket.destroy();
  server.close();
  console.log("SEEN it fired");
}, 5000);
test("the clock does not end the library's timers", async () => {
  jest.useFakeTimers();
  const server = net.createServer(() => {});
  server.listen(0);
  await once(server, "listening");
  const socket = net.connect(server.address().port);
  await once(socket, "connect");
  let fired = false;
  socket.setTimeout(60_000, () => (fired = true));
  jest.advanceTimersByTime(120_000);
  await Promise.resolve();
  console.log("SEEN", fired, jest.getTimerCount());
  socket.destroy();
  server.close();
}, 5000);
`,
};

test("fake timers stop the timers of the run's own code and of no built-in module", async () => {
  using dir = tempDir("aot-fake-timers-leave-the-library-alone", faked);
  const plain = await runTests(String(dir), undefined);
  expect(plain).toEqual({
    stdout: ["SEEN it fired", "SEEN false 0"],
    results: [
      "pass a socket's own timeout fires without a tick of the clock",
      "pass the clock does not end the library's timers",
    ],
    exitCode: 0,
  });
  const [oneProgram, layers] = await Promise.all([
    runTests(String(dir), undefined, "--aot"),
    runTests(String(dir), "TestRunLayers:2", "--aot"),
  ]);
  expect(oneProgram).toEqual(plain);
  expect(layers).toEqual(plain);
}, 240_000);
