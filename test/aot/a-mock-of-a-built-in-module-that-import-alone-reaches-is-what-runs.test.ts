import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(120_000);

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

// No file of the run imports the module by a statement, which would list its exports. The second file keeps it a run of several files.
async function expectCompiledToRunAsPlain(body: string, files: Record<string, string> = {}) {
  using dir = tempDir("a-mock-of-a-built-in-module", {
    ...files,
    "package.json": `{ "name": "p", "type": "module" }`,
    "tsconfig.json": "{}",
    "second.test.js": `import { expect, test } from "bun:test";\ntest("second", () => { expect(1).toBe(1); });`,
    "first.test.js": `
      import { mock, test } from "bun:test";
      function mocked() { return "mocked"; }
      class Mocked { say() { return "mocked"; } }
      test("first", async () => {${body}});`,
  });
  const plain = await runTests(String(dir));
  expect(plain.results).toEqual(["pass first", "pass second"]);
  expect(plain.stdout).toContain("mocked");
  expect(plain.stdout).not.toContain("real");
  expect(await runTests(String(dir), "--debug-aot")).toEqual(plain);
}

test("a function of the mock is called", async () => {
  await expectCompiledToRunAsPlain(`
    mock.module("node:dns", () => ({ getDefaultResultOrder: mocked, default: { getDefaultResultOrder: mocked } }));
    const dns = await import("node:dns");
    const { getDefaultResultOrder } = dns;
    console.log(dns.getDefaultResultOrder === mocked, dns.getDefaultResultOrder(), getDefaultResultOrder());
    console.log(dns.default.getDefaultResultOrder(), dns["getDefault" + "ResultOrder"]());`);
});

test("a class of the mock is constructed", async () => {
  await expectCompiledToRunAsPlain(`
    mock.module("node:dns", () => ({ Resolver: Mocked }));
    const dns = await import("node:dns");
    const { Resolver } = dns;
    console.log(new dns.Resolver().say?.() ?? "real", new Resolver().say?.() ?? "real");`);
});

test("the classes of node:events and node:stream", async () => {
  await expectCompiledToRunAsPlain(`
    mock.module("node:events", () => ({ EventEmitter: Mocked }));
    console.log(new (await import("node:events")).EventEmitter().say?.() ?? "real");
    mock.module("node:stream", () => ({ Readable: Mocked }));
    console.log(new (await import("node:stream")).Readable().say?.() ?? "real");`);
});

test("what keeps a test from starting a process", async () => {
  await expectCompiledToRunAsPlain(`
    mock.module("node:child_process", () => ({ exec: mocked, execSync: mocked }));
    const { exec, execSync } = await import("node:child_process");
    console.log(exec("exit 1"), execSync("exit 1"));`);
});

test("the namespace object comes through then and Promise.all", async () => {
  await expectCompiledToRunAsPlain(`
    mock.module("node:zlib", () => ({ Gzip: Mocked }));
    await import("node:zlib").then(zlib => console.log(new zlib.Gzip().say?.() ?? "real"));
    mock.module("node:path", () => ({ join: mocked }));
    const [path] = await Promise.all([import("node:path")]);
    console.log(path.join("real", "real"));`);
});

// The image holds no code of them, and the loader of Bun has the mock.
test("modules of native code", async () => {
  await expectCompiledToRunAsPlain(`
    mock.module("node:util/types", () => ({ isAnyArrayBuffer: mocked }));
    const types = await import("node:util/types");
    console.log(types.isAnyArrayBuffer === mocked, types.isAnyArrayBuffer(1));
    mock.module("node:string_decoder", () => ({ StringDecoder: Mocked }));
    console.log(new (await import("node:string_decoder")).StringDecoder().say?.() ?? "real");
    mock.module("node:buffer", () => ({ atob: mocked }));
    const { atob } = await import("node:buffer");
    console.log(atob("cmVhbA=="));`);
});

test("a module of native code that is not mocked, beside one that is", async () => {
  await expectCompiledToRunAsPlain(`
    mock.module("node:util/types", () => ({ isDate: mocked }));
    console.log((await import("node:util/types")).isDate(1));
    console.log(new (await import("node:string_decoder")).StringDecoder("utf8").write(Buffer.from("kept")));`);
});

test("a module of native code that was imported before the mock", async () => {
  await expectCompiledToRunAsPlain(`
    const first = await import("node:util/types");
    mock.module("node:util/types", () => ({ ...first, isDate: mocked }));
    const again = await import("node:util/types");
    console.log(first.isDate === mocked, again.isDate === mocked, again === first, again.isDate(1), again.isRegExp(/a/));`);
});

test("a file that imports a module of native code by a statement and loads behind the mock", async () => {
  await expectCompiledToRunAsPlain(
    `
    mock.module("node:string_decoder", () => ({ StringDecoder: Mocked }));
    const { all, make } = await import("./helper.js");
    console.log(make().say?.() ?? "real", new all.StringDecoder().say?.() ?? "real");`,
    {
      "helper.js": `
        import { StringDecoder } from "node:string_decoder";
        import * as all from "node:string_decoder";
        export const make = () => new StringDecoder();
        export { all };`,
    },
  );
});

// The compiler knows createRequire and Module by the table of built-ins, and binds what it knows.
test("the names of node:module that the compiler knows", async () => {
  await expectCompiledToRunAsPlain(
    `
    const real = { ...(await import("node:module")) };
    mock.module("node:module", () => ({ ...real, Module: Mocked, createRequire: mocked }));
    const { all, byName, call } = await import("./helper.js");
    console.log(byName()[0] === Mocked, byName()[1] === mocked, all.Module === Mocked, all.createRequire === mocked, call());`,
    {
      "helper.js": `
        import { Module, createRequire } from "node:module";
        import * as all from "node:module";
        export const byName = () => [Module, createRequire];
        export const call = () => createRequire(import.meta.url);
        export { all };`,
    },
  );
});

test("createRequire in a run that mocks another module", async () => {
  await expectCompiledToRunAsPlain(
    `
    mock.module("node:dns", () => ({ getDefaultResultOrder: mocked }));
    const { load } = await import("./helper.js");
    console.log((await import("node:dns")).getDefaultResultOrder(), load().sep.length);`,
    {
      "helper.js": `
        import { createRequire } from "node:module";
        const require = createRequire(import.meta.url);
        export const load = () => require("node:path");`,
    },
  );
});

// The body of bun:ffi deletes a member of Bun.FFI, which it can do as long as the compiler knows what Bun.FFI is.
test("bun:ffi in a run that also mocks bun", async () => {
  await expectCompiledToRunAsPlain(`
    mock.module("bun", () => ({ added: 1 }));
    mock.module("bun:ffi", () => ({ CFunction: mocked, default: { CFunction: mocked } }));
    const ffi = await import("bun:ffi");
    console.log(ffi.CFunction === mocked, ffi.CFunction(), ffi.default.CFunction());`);
});

// The loader's entry for the module is the image's, and code that is not in the image comes to it by require().
test("a module written at run time requires a module of native code that compiled code has imported and mocked", async () => {
  await expectCompiledToRunAsPlain(`
    const first = await import("bun:jsc");
    mock.module("bun:jsc", () => ({ ...first, heapSize: mocked }));
    // No build can know the name, so the file is in no image.
    const path = import.meta.dir + "/written-" + process.pid + ".mjs";
    await Bun.write(path, 'export const got = require("bun:jsc");');
    const { got } = await import(path);
    console.log(got.heapSize === mocked, got.heapSize(), typeof got.gcAndSweep);`);
});

// The written module gets the loader's module, the helper the image's. The mock stands in both.
test("a module written at run time imports a mocked module of native code before a compiled file does", async () => {
  await expectCompiledToRunAsPlain(
    `
    mock.module("node:util/types", () => ({ added: 1, isDate: mocked }));
    const path = import.meta.dir + "/written-" + process.pid + ".mjs";
    await Bun.write(path, 'export * as types from "node:util/types";');
    const { types } = await import(path);
    const { seen } = await import("./helper.js");
    console.log(types.added, types.isDate(1), seen());`,
    {
      "helper.js": `
        import * as all from "node:util/types";
        import { isDate } from "node:util/types";
        export const seen = () => [all.added ?? "real", all.isDate === isDate, isDate(1) || "real"].join();`,
    },
  );
});
