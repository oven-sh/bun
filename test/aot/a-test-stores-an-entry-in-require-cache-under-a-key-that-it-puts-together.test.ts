import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone.
raiseDefaultTimeout(120_000);

// One project for each way to hide the key: a way that opens every module would hide what another leaves closed.
const head = `import { test } from "bun:test";`;
const shared = {
  "package.json": `{}`,
  "node_modules/pk/package.json": `{ "name": "pk", "main": "index.js" }`,
  "node_modules/pk/index.js": `
    exports.url = () => typeof require("url").parse;
    exports.os = () => typeof require("os").platform;
    exports.events = () => typeof require("events").once;
    exports.ws = () => typeof require("ws").WebSocket;`,
  "required.cjs": `
    exports.url = () => typeof require("url").parse;
    exports.held = require("url");`,
};

const projects: Record<string, Record<string, string>> = {
  "a key that nothing in the file tells": {
    ...shared,
    "one.test.js": `${head}
      import { createRequire } from "node:module";
      import realUrl from "url";
      test("the key comes out of bytes", async () => {
        const required = require("./required.cjs");
        const pk = require("pk");
        const key = Buffer.from("75726c", "hex").toString();
        console.log("before:", typeof require("url").parse, required.url(), pk.url());
        const entry = { exports: { parse: 1 } };
        require.cache[key] = entry;
        console.log("stored:", typeof require("url").parse, required.url(), pk.url());
        console.log("the module:", typeof require("node:url").parse, typeof process.getBuiltinModule("url").parse, typeof required.held.parse);
        console.log("imports:", typeof realUrl.parse, typeof (await import("url")).parse);
        console.log("made:", typeof createRequire(import.meta.url)("url").parse, typeof import.meta.require("url").parse);
        console.log("others:", typeof require("zlib").gzipSync, pk.os(), pk.events());
        console.log("the same:", require("url") === entry.exports, require.cache.url === entry);
        entry.exports = { parse: "text" };
        console.log("other exports:", typeof require("url").parse, required.url(), pk.url());
        require.cache[key] = undefined;
        console.log("undefined:", typeof require("url").parse, required.url(), pk.url());
        require.cache[key] = entry;
        delete require.cache[key];
        console.log("deleted:", typeof require("url").parse, required.url(), pk.url(), require("url") === require("node:url"), require("url") === realUrl);
      });`,
  },

  "a helper in another file that takes the name": {
    ...shared,
    "stub.cjs": `
      exports.stub = (name, exports) => { require.cache[require.resolve(name)] = { exports }; };
      exports.restore = name => { delete require.cache[require.resolve(name)]; };`,
    "one.test.js": `${head}
      test("the helper stores", () => {
        const { stub, restore } = require("./stub.cjs");
        stub("os", { platform: 1 });
        console.log("stored:", typeof require("os").platform, require("pk").os(), typeof require("node:os").platform, require("pk").url());
        restore("os");
        console.log("restored:", typeof require("os").platform, require("pk").os());
      });`,
  },

  "the table handed to a function": {
    ...shared,
    "one.test.js": `${head}
      const put = (table, key, entry) => { table[key] = entry; };
      const take = (table, key) => { delete table[key]; };
      test("the function stores", () => {
        const key = Buffer.from("6576656e7473", "hex").toString();
        put(require.cache, key, { exports: { once: 1 } });
        console.log("stored:", typeof require("events").once, require("pk").events(), typeof require("node:events").once, require("pk").url());
        take(require.cache, key);
        console.log("taken out:", typeof require("events").once, require("pk").events());
      });`,
  },

  "a key that the test spells, and a package that reads a member": {
    ...shared,
    "one.test.js": `${head}
      test("the test stores", () => {
        require.cache["os"] = { exports: { platform: 1 } };
        console.log("stored:", typeof require("os").platform, require("pk").os(), typeof require("node:os").platform, require("pk").url());
        delete require.cache["os"];
        console.log("taken out:", typeof require("os").platform, require("pk").os());
      });`,
  },

  "one of Bun's own names, and a package that holds the module": {
    ...shared,
    "one.test.js": `${head}
      test("the test stores", () => {
        const key = Buffer.from("7773", "hex").toString();
        require.cache[key] = { exports: { WebSocket: 1 } };
        console.log("stored:", typeof require("ws").WebSocket, require("pk").ws(), require("pk").url());
        delete require.cache[key];
        console.log("taken out:", typeof require("ws").WebSocket, require("pk").ws());
      });`,
  },

  "one of Bun's own names that the test spells, and a package that holds the module": {
    ...shared,
    "one.test.js": `${head}
      test("the test stores", () => {
        require.cache["ws"] = { exports: { WebSocket: 1 } };
        console.log("stored:", typeof require("ws").WebSocket, require("pk").ws(), require("pk").url());
        delete require.cache["ws"];
        console.log("taken out:", typeof require("ws").WebSocket, require("pk").ws());
      });`,
  },

  "Reflect.set, Object.assign and Object.defineProperty": {
    ...shared,
    "one.test.js": `${head}
      test("calls that store", () => {
        const name = hex => Buffer.from(hex, "hex").toString();
        Reflect.set(require.cache, name("75726c"), { exports: { parse: 1 } });
        Object.assign(require.cache, { [name("6f73")]: { exports: { platform: 1 } } });
        Object.defineProperty(require.cache, name("6576656e7473"), { value: { exports: { once: 1 } }, configurable: true, enumerable: true, writable: true });
        const pk = require("pk");
        console.log("stored:", typeof require("url").parse, typeof require("os").platform, typeof require("events").once, pk.url(), pk.os(), pk.events());
        for (const key of ["75726c", "6f73", "6576656e7473"].map(name)) delete require.cache[key];
        console.log("taken out:", typeof require("url").parse, typeof require("os").platform, typeof require("events").once, pk.url(), pk.os(), pk.events());
      });`,
  },

  "Module._cache and a name that holds the table": {
    ...shared,
    "one.test.js": `${head}
      import Module from "node:module";
      test("other ways to the table", () => {
        const name = hex => Buffer.from(hex, "hex").toString();
        Module._cache[name("75726c")] = { exports: { parse: 1 } };
        const table = require.cache;
        table[name("6f73")] = { exports: { platform: 1 } };
        const pk = require("pk");
        console.log("stored:", typeof require("url").parse, typeof require("os").platform, pk.url(), pk.os(), pk.events());
        delete Module._cache[name("75726c")];
        delete table[name("6f73")];
        console.log("taken out:", typeof require("url").parse, typeof require("os").platform, pk.url(), pk.os());
      });`,
  },

  "stores that no require() of a spelled name finds": {
    ...shared,
    "one.test.js": `${head}
      test("they go through", () => {
        const name = hex => Buffer.from(hex, "hex").toString();
        const zlib = name("7a6c6962");
        require.cache[zlib] = { exports: { gzipSync: 1 } };
        console.log("stored:", typeof require(zlib).gzipSync, typeof require.cache[zlib].exports.gzipSync, typeof require("node:zlib").gzipSync);
        require.cache[name("75726c")] = undefined;
        console.log("falsy:", typeof require("url").parse, require("pk").url());
        require.cache["node:" + name("75726c")] = { exports: 1 };
        console.log("with node:", typeof require("url").parse, typeof require("node:url").parse);
        require.cache[name("6e6f2d73756368")] = { exports: 1 };
        console.log("no module:", Object.keys(require.cache).includes("no-such"));
        require.cache[name("7574696c")] = { exports: { inspect: 1 } };
        console.log("only with node:", typeof require("node:util").inspect);
      });`,
  },
};

const asOneProgram = { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" };
const ways: [string, Record<string, string>][] = [
  ["as one program", asOneProgram],
  ["in layers", { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" }],
  ["with the test files from disk", { BUN_AOT_TEST_FILES_FROM_DISK: "1", BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1" }],
];

async function runTests(directory: string, env: Record<string, string>, flag?: "--aot", log?: string[]) {
  const command = [bunExe(), "test", "--isolate", ...(flag ? [flag] : [])];
  const { stdout, stderr, exitCode } = await run(command, directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  log?.push(stderr);
  const printed = stdout.split("\n").filter(line => line && !line.startsWith("bun test "));
  return { printed, results: results.sort(), exitCode };
}

const toldByScan = Object.keys(projects).slice(0, 6);

for (const [name, files] of Object.entries(projects)) {
  for (const [way, env] of toldByScan.includes(name) ? ways : ways.slice(0, 1)) {
    test.concurrent(`${name}, ${way}`, async () => {
      using dir = tempDir("a-key-of-require-cache-that-is-put-together", files);
      const plain = await runTests(String(dir), {});
      expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
      expect(plain.printed.find(line => line.startsWith("stored:"))).toStartWith("stored: number number");
      expect(await runTests(String(dir), env, "--aot")).toEqual(plain);
    });
  }
}

const opened = (stderr: string) =>
  [
    ...stderr.matchAll(
      /^AOT test run \| an entry in require\.cache may answer require\(\) of (\d+) modules of the library/gm,
    ),
  ].map(match => Number(match[1]));

type KeyKnownInPart = { name: string; declared: string; cleared?: string; stored: string; opens: number[] };
const keysKnownInPart: KeyKnownInPart[] = [
  {
    name: "a list of letters that is joined names one module",
    declared: `const key = ["u", "r", "l"].join("");`,
    stored: "stored: number function function",
    opens: [1],
  },
  {
    name: "a variable that is stored to more than once names what it is given",
    declared: `let key; key = ["u", "rl"].join("");`,
    cleared: `key = undefined;`,
    stored: "stored: number function function",
    opens: [1],
  },
  {
    name: "a key of which only the start is known names the modules that start so",
    declared: `const key = "ur" + Buffer.from("6c", "hex");`,
    stored: "stored: number function function",
    opens: [1],
  },
  {
    name: "a path below a folder that nobody knows names no module",
    declared: `const key = require("node:path").join(process.env.SOME_FOLDER ?? "", process.platform, "addon.node");`,
    stored: "stored: function function function",
    opens: [],
  },
  {
    name: "a path that is kept in a variable and cleared again names no module",
    declared: `let key; key = require("node:path").resolve(process.env.SOME_FOLDER ?? "", "addon.node");`,
    cleared: `key = undefined;`,
    stored: "stored: function function function",
    opens: [],
  },
];

for (const { name, declared, cleared = "", stored, opens } of keysKnownInPart) {
  test.concurrent(name, async () => {
    using dir = tempDir("a-key-of-require-cache-that-is-known-in-part", {
      "package.json": `{}`,
      "one.test.js": `${head}
        test("the store", () => {
          ${declared}
          require.cache[key] = { exports: { parse: 1, inspect: 1, platform: 1 } };
          console.log("stored:", typeof require("url").parse, typeof require("util").inspect, typeof require("os").platform);
          delete require.cache[key];
          ${cleared}
        });`,
    });
    const plain = await runTests(String(dir), {});
    expect(plain.printed).toEqual([stored]);
    const log: string[] = [];
    expect(await runTests(String(dir), { ...asOneProgram, BUN_JSC_logAOTPhaseTimes: "1" }, "--aot", log)).toEqual(
      plain,
    );
    expect([...new Set(opened(log.join("")))]).toEqual(opens);
  });
}

test.concurrent("a store in a file that the test writes is refused by name", async () => {
  using dir = tempDir("a-store-into-require-cache-that-the-build-never-saw", {
    "package.json": `{}`,
    "one.test.js": `${head}
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";
      test("the file stores", () => {
        const late = join(import.meta.dir, ["late", "cjs"].join("."));
        writeFileSync(late, ["require", ".", "cache", "[", JSON.stringify("url"), "] = { exports: { parse: 1 } };"].join(""));
        let said = "stored";
        try { require(late); } catch (error) { said = String(error.message).split(": ")[0]; }
        console.log(said, typeof require("url").parse);
      });`,
  });
  const { printed, results } = await runTests(String(dir), asOneProgram, "--aot");
  expect(results).toEqual(["pass the file stores"]);
  expect(printed).toEqual(["Cannot store an entry under 'url' in require.cache function"]);
});
