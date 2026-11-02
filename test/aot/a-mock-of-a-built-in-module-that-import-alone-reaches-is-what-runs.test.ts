import { expect } from "bun:test";
import { casesOfOneRun, sayOf } from "./harness/cases-of-one-run";
import { test } from "./supported";

const project = (name: string) =>
  casesOfOneRun("a-mock-of-a-built-in-module-" + name, {
    "package.json": `{ "name": "p", "type": "module" }`,
    "tsconfig.json": "{}",
  });
// The cases of a project are compiled as one program, so what one of them says about a module holds for all. No file of the first imports a
// module by a statement, which would list its exports. In the others no module is imported by a statement in one case and without one in another.
const byImportAlone = project("by-import-alone");
const besideAMockOfBun = project("beside-a-mock-of-bun");
const ofLibrary = project("of-library");
const byStatements = project("by-statements");
const byOtherStatements = project("by-other-statements");
// A name that the build cannot know opens the whole program.
const byComputedNames = project("by-computed-names");
// Each test file is an image of its own over the image of the library, so the loader of the host stands between them. A run in layers builds
// the library anew, so there is one.
const inLayers = project("in-layers");

function runsAsPlain(
  group: ReturnType<typeof project>,
  title: string,
  body: string,
  files: Record<string, string> = {},
  inLayersToo = false,
) {
  const testFile = (name: string) => `
      import { mock, test } from "bun:test";
      ${sayOf(name)}
      function mocked() { return "mocked"; }
      class Mocked { say() { return "mocked"; } }
      test("${name}", async () => {${body.replaceAll("console.log(", "say(")}});`;
  const name = group.add(testFile, files);
  const nameInLayers = inLayersToo ? inLayers.add(testFile, files) : undefined;
  test(title, async () => {
    const plain = (await group.ran()).get(name);
    expect(plain?.result).toBe("pass");
    expect(plain?.printed).toContain("mocked");
    expect(plain?.printed).not.toContain("real");
    expect((await group.ran(["--debug-aot"])).get(name)).toEqual(plain);
    if (nameInLayers)
      expect((await inLayers.ran(["--debug-aot"], "TestRunLayers:2,TestRunPartFiles:1")).get(nameInLayers)).toEqual(
        plain,
      );
  });
}

runsAsPlain(
  byImportAlone,
  "a function of the mock is called",
  `
    mock.module("node:dns", () => ({ getDefaultResultOrder: mocked, default: { getDefaultResultOrder: mocked } }));
    const dns = await import("node:dns");
    const { getDefaultResultOrder } = dns;
    console.log(dns.getDefaultResultOrder === mocked, dns.getDefaultResultOrder(), getDefaultResultOrder());
    console.log(dns.default.getDefaultResultOrder(), dns["getDefault" + "ResultOrder"]());`,
);

runsAsPlain(
  byImportAlone,
  "a class of the mock is constructed",
  `
    mock.module("node:dns", () => ({ Resolver: Mocked }));
    const dns = await import("node:dns");
    const { Resolver } = dns;
    console.log(new dns.Resolver().say?.() ?? "real", new Resolver().say?.() ?? "real");`,
);

runsAsPlain(
  byImportAlone,
  "the classes of node:events and node:stream",
  `
    mock.module("node:events", () => ({ EventEmitter: Mocked }));
    console.log(new (await import("node:events")).EventEmitter().say?.() ?? "real");
    mock.module("node:stream", () => ({ Readable: Mocked }));
    console.log(new (await import("node:stream")).Readable().say?.() ?? "real");`,
);

runsAsPlain(
  byImportAlone,
  "what keeps a test from starting a process",
  `
    mock.module("node:child_process", () => ({ exec: mocked, execSync: mocked }));
    const { exec, execSync } = await import("node:child_process");
    console.log(exec("exit 1"), execSync("exit 1"));`,
);

runsAsPlain(
  byImportAlone,
  "the namespace object comes through then and Promise.all",
  `
    mock.module("node:zlib", () => ({ Gzip: Mocked }));
    await import("node:zlib").then(zlib => console.log(new zlib.Gzip().say?.() ?? "real"));
    mock.module("node:path", () => ({ join: mocked }));
    const [path] = await Promise.all([import("node:path")]);
    console.log(path.join("real", "real"));`,
);

// The image holds no code of them, and the loader of Bun has the mock.
runsAsPlain(
  byImportAlone,
  "modules of native code",
  `
    mock.module("node:util/types", () => ({ isAnyArrayBuffer: mocked }));
    const types = await import("node:util/types");
    console.log(types.isAnyArrayBuffer === mocked, types.isAnyArrayBuffer(1));
    mock.module("node:string_decoder", () => ({ StringDecoder: Mocked }));
    console.log(new (await import("node:string_decoder")).StringDecoder().say?.() ?? "real");
    mock.module("node:buffer", () => ({ atob: mocked }));
    const { atob } = await import("node:buffer");
    console.log(atob("cmVhbA=="));`,
);

runsAsPlain(
  byOtherStatements,
  "a module of native code that is not mocked, beside one that is",
  `
    mock.module("node:util/types", () => ({ isDate: mocked }));
    console.log((await import("node:util/types")).isDate(1));
    console.log(new (await import("node:string_decoder")).StringDecoder("utf8").write(Buffer.from("kept")));`,
);

runsAsPlain(
  byImportAlone,
  "a module of native code that was imported before the mock",
  `
    const first = await import("node:util/types");
    mock.module("node:util/types", () => ({ ...first, isDate: mocked }));
    const again = await import("node:util/types");
    console.log(first.isDate === mocked, again.isDate === mocked, again === first, again.isDate(1), again.isRegExp(/a/));`,
);

runsAsPlain(
  byStatements,
  "a file that imports a module of native code by a statement and loads behind the mock",
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

// The compiler knows createRequire and Module by the table of built-ins, and binds what it knows.
runsAsPlain(
  byOtherStatements,
  "the names of node:module that the compiler knows",
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

runsAsPlain(
  byStatements,
  "createRequire in a run that mocks another module",
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

// The body of bun:ffi deletes a member of Bun.FFI, which it can do as long as the compiler knows what Bun.FFI is.
runsAsPlain(
  besideAMockOfBun,
  "bun:ffi in a run that also mocks bun",
  `
    mock.module("bun", () => ({ added: 1 }));
    mock.module("bun:ffi", () => ({ CFunction: mocked, default: { CFunction: mocked } }));
    const ffi = await import("bun:ffi");
    console.log(ffi.CFunction === mocked, ffi.CFunction(), ffi.default.CFunction());`,
);

// The loader's entry for the module is the image's, and code that is not in the image comes to it by require().
runsAsPlain(
  byComputedNames,
  "a module written at run time requires a module of native code that compiled code has imported and mocked",
  `
    const first = await import("bun:jsc");
    mock.module("bun:jsc", () => ({ ...first, heapSize: mocked }));
    // No build can know the name, so the file is in no image.
    const path = import.meta.dir + "/written-" + process.pid + ".mjs";
    await Bun.write(path, 'export const got = require("bun:jsc");');
    const { got } = await import(path);
    console.log(got.heapSize === mocked, got.heapSize(), typeof got.gcAndSweep);`,
);

// The written module gets the loader's module, the helper the image's. The mock stands in both.
runsAsPlain(
  byComputedNames,
  "a module written at run time imports a mocked module of native code before a compiled file does",
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

// Under `bun run` a mock stands in place of a module that no import has loaded, with its own names alone, and is laid over one that an import has.
// `require` takes a name that starts with `node:` to the registry, where no mock stands, and every other name to the loader.
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

for (const name of modulesOfLibrary) {
  runsAsPlain(
    ofLibrary,
    `${name} is mocked before anything has loaded it`,
    `${told(name)}
    console.log(Object.keys(required).length);`,
    {},
    true,
  );
  runsAsPlain(
    ofLibrary,
    `${name} is mocked behind a require() of it`,
    `
    require("${name}");${told(name)}
    console.log(Object.keys(required).length);`,
    {},
    true,
  );
  runsAsPlain(
    ofLibrary,
    `${name} is mocked behind an import() of it`,
    `
    const first = await import("${name}");
    const key = Object.keys(first).find(key => key !== "default" && typeof first[key] === "function");
    mock.module("${name}", () => ({ ...first, [key]: mocked, marker: "mocked" }));
    const required = require("${name}"), imported = await import("${name}");
    console.log(key, imported === first, imported[key] === mocked && imported[key](), imported.marker ?? null, required.marker ?? null, Object.keys(imported).length);`,
    {},
    true,
  );
  // The loader holds such a module as an ES module once an import has loaded it, so require() answers the namespace object, which shows the mock.
  // Where what the factory made has `__esModule` and `default`, as a copy of bun:sqlite has, require() answers that `default`.
  runsAsPlain(
    ofLibrary,
    `require("${name}") behind an import() of it and a mock`,
    `
      const first = await import("${name}");
      const key = Object.keys(first).find(key => key !== "default" && typeof first[key] === "function");
      mock.module("${name}", () => ({ ...first, [key]: mocked }));
      console.log(mocked(), require("${name}")[key] === mocked, require("${name}") === first, Object.keys(require("${name}")).length);`,
    {},
    true,
  );
}

runsAsPlain(
  byOtherStatements,
  "a file that requires a module which a statement has imported and a mock is laid over",
  `
  const { Socket } = await import("./helper.js");
  mock.module("ws", () => ({ WebSocket: Mocked }));
  console.log(Socket === Mocked, new (require("./helper.cjs")())().say?.() ?? "real");`,
  {
    "helper.js": `import { WebSocket } from "ws";\nexport { WebSocket as Socket };`,
    "helper.cjs": `module.exports = () => require("ws").WebSocket;`,
  },
  true,
);

runsAsPlain(
  byComputedNames,
  "what is read straight off a require() of a mocked module",
  `
    mock.module("undici", () => ({ fetch: mocked, marker: "mocked" }));
    const { fetch } = require("undici");
    const whole = require("undici");
    console.log(require("undici").fetch.length, require("undici").fetch(), fetch(), whole.fetch(), require("undici").marker, whole.marker);
    console.log(import.meta.require("undici").fetch(), require(["und", "ici"].join("")).fetch(), whole === require("undici"));`,
  {},
  true,
);

runsAsPlain(
  byStatements,
  "a file that requires a mocked module and loads behind the mock",
  `
  mock.module("ws", () => ({ WebSocket: Mocked }));
  mock.module("node:os", () => ({ homedir: mocked }));
  console.log(require("./helper.cjs").join());`,
  {
    "helper.cjs": `module.exports = [new (require("ws").WebSocket)().say?.() ?? "real", require("node:os").homedir === require("os").homedir, typeof require("node:os").platform];`,
  },
  true,
);

runsAsPlain(
  byOtherStatements,
  "a module that a statement has imported is patched, and keeps the names that the mock leaves out",
  `
  const { seen } = await import("./helper.js");
  mock.module("node:os", () => ({ homedir: mocked }));
  const imported = await import("node:os");
  console.log(seen(), imported.homedir(), typeof imported.platform, typeof require("node:os").platform);`,
  { "helper.js": `import { homedir } from "node:os";\nexport const seen = () => homedir();` },
  true,
);
