import { expect, setDefaultTimeout } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

setDefaultTimeout(120_000);

async function runTests(directory: string, flags: string[] = [], words?: string) {
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

// No file of the run imports the module by a statement, which would list its exports. The second file keeps it a run of several files.
async function expectCompiledToRunAsPlain(body: string, files: Record<string, string> = {}, inLayersToo = false) {
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
  expect(await runTests(String(dir), ["--debug-aot"])).toEqual(plain);
  // Each test file is an image of its own over the image of the library, so the loader of the host stands between them.
  if (inLayersToo)
    expect(await runTests(String(dir), ["--debug-aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
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

// Under `bun run` a mock stands in place of a module that no import has loaded, with its own names alone, and is laid over one that an import has.
// `require` takes a name that starts with `node:` to the registry, where no mock stands, and every other name to the loader.
const expectToRunAsPlainInLayersToo = (body: string, files: Record<string, string> = {}) =>
  expectCompiledToRunAsPlain(body, files, true);
// One with code, one that `require` takes to the registry, one of native code: a run in layers builds the library anew.
const expectOf = (name: string) => (body: string) =>
  expectCompiledToRunAsPlain(body, {}, ["ws", "node:os", "bun:jsc"].includes(name));
const modulesOfLibrary = [
  "bun:sqlite",
  "bun:ffi",
  "bun:jsc",
  "ws",
  "undici",
  "node:os",
  "node:events",
  "node:fs",
  "node:path",
];
const told = (name: string) => `
    mock.module("${name}", () => ({ marker: "mocked" }));
    const required = require("${name}"), imported = await import("${name}");
    console.log(required.marker ?? null, imported.marker ?? null, Object.keys(imported).length, required === require("${name}"));`;

test.each(modulesOfLibrary)("%s is mocked before anything has loaded it", async name => {
  await expectOf(name)(`${told(name)}
    console.log(Object.keys(required).length);`);
});

test.each(modulesOfLibrary)("%s is mocked behind a require() of it", async name => {
  await expectOf(name)(`
    require("${name}");${told(name)}
    console.log(Object.keys(required).length);`);
});

test.each(modulesOfLibrary)("%s is mocked behind an import() of it", async name => {
  await expectOf(name)(`
    const first = await import("${name}");
    const key = Object.keys(first).find(key => key !== "default" && typeof first[key] === "function");
    mock.module("${name}", () => ({ ...first, [key]: mocked, marker: "mocked" }));
    const required = require("${name}"), imported = await import("${name}");
    console.log(key, imported === first, imported[key] === mocked && imported[key](), imported.marker ?? null, required.marker ?? null, Object.keys(imported).length);`);
});

// The loader holds such a module as an ES module once an import has loaded it, so require() answers the namespace object, which shows the mock.
// TODO: where what the factory made has `__esModule` and `default`, as a copy of bun:sqlite has, plain's require() answers that `default`.
for (const name of modulesOfLibrary) {
  const declare = name === "bun:sqlite" ? test.todo : test;
  declare(`require("${name}") behind an import() of it and a mock`, async () => {
    await expectOf(name)(`
      const first = await import("${name}");
      const key = Object.keys(first).find(key => key !== "default" && typeof first[key] === "function");
      mock.module("${name}", () => ({ ...first, [key]: mocked }));
      console.log(mocked(), require("${name}")[key] === mocked, require("${name}") === first, Object.keys(require("${name}")).length);`);
  });
}

test("a file that requires a module which a statement has imported and a mock is laid over", async () => {
  await expectToRunAsPlainInLayersToo(
    `
    const { Socket } = await import("./helper.js");
    mock.module("ws", () => ({ WebSocket: Mocked }));
    console.log(Socket === Mocked, new (require("./helper.cjs")())().say?.() ?? "real");`,
    {
      "helper.js": `import { WebSocket } from "ws";\nexport { WebSocket as Socket };`,
      "helper.cjs": `module.exports = () => require("ws").WebSocket;`,
    },
  );
});

test("what is read straight off a require() of a mocked module", async () => {
  await expectToRunAsPlainInLayersToo(`
    mock.module("undici", () => ({ fetch: mocked, marker: "mocked" }));
    const { fetch } = require("undici");
    const whole = require("undici");
    console.log(require("undici").fetch.length, require("undici").fetch(), fetch(), whole.fetch(), require("undici").marker, whole.marker);
    console.log(import.meta.require("undici").fetch(), require(["und", "ici"].join("")).fetch(), whole === require("undici"));`);
});

test("a file that requires a mocked module and loads behind the mock", async () => {
  await expectToRunAsPlainInLayersToo(
    `
    mock.module("ws", () => ({ WebSocket: Mocked }));
    mock.module("node:os", () => ({ homedir: mocked }));
    console.log(require("./helper.cjs").join());`,
    {
      "helper.cjs": `module.exports = [new (require("ws").WebSocket)().say?.() ?? "real", require("node:os").homedir === require("os").homedir, typeof require("node:os").platform];`,
    },
  );
});

test("a module that a statement has imported is patched, and keeps the names that the mock leaves out", async () => {
  await expectToRunAsPlainInLayersToo(
    `
    const { seen } = await import("./helper.js");
    mock.module("node:os", () => ({ homedir: mocked }));
    const imported = await import("node:os");
    console.log(seen(), imported.homedir(), typeof imported.platform, typeof require("node:os").platform);`,
    { "helper.js": `import { homedir } from "node:os";\nexport const seen = () => homedir();` },
  );
});
