import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { givenToABunWithAssertions, raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

// supported.ts sets the limit for the first file of a process alone. In a debug build a run in layers takes 90 s on twelve
// processors with nothing beside it, and `bun test` has five cases under way. So a case gets three times what the helper
// gives a Bun with assertions.
raiseDefaultTimeout(isDebug ? 3 * givenToABunWithAssertions : 120_000);

type Project = {
  files: Record<string, string>;
  /** What plain `bun test` says of the project, and a compiled run has to say too: the lines that its test prints. */
  printed: string[];
  /** And how the test ends. */
  results: string[];
};

// One project for each way to hide the key: a way that opens every module would hide what another leaves closed.
const head = `import { test } from "bun:test";`;
const shared = {
  "package.json": `{}`,
  "node_modules/pk/package.json": `{ "name": "pk", "main": "index.js" }`,
  "node_modules/pk/index.js": `
    exports.url = () => typeof require("url").parse;
    exports.os = () => typeof require("os").platform;
    exports.events = () => typeof require("events").once;`,
  "required.cjs": `
    exports.url = () => typeof require("url").parse;
    exports.held = require("url");`,
};
// Bun's own `ws` loads node:http, node:net and node:tls, and a build compiles all of them for a package that names `ws`, in each
// of the three ways. So the package names `ws` only in the projects whose test asks it for that.
const sharedWithWs = {
  ...shared,
  "node_modules/pk/index.js": `${shared["node_modules/pk/index.js"]}
    exports.ws = () => typeof require("ws").WebSocket;`,
};

const projects: Record<string, Project> = {
  "a key that nothing in the file tells": {
    files: {
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
    printed: [
      "before: function function function",
      "stored: number number number",
      "the module: function function function",
      "imports: function function",
      "made: number number",
      "others: function function function",
      "the same: true true",
      "other exports: string string string",
      "undefined: function function function",
      "deleted: function function function true true",
    ],
    results: ["pass the key comes out of bytes"],
  },

  "a helper in another file that takes the name": {
    files: {
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
    printed: ["stored: number number function function", "restored: function function"],
    results: ["pass the helper stores"],
  },

  "the table handed to a function": {
    files: {
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
    printed: ["stored: number number function function", "taken out: function function"],
    results: ["pass the function stores"],
  },

  "a key that the test spells, and a package that reads a member": {
    files: {
      ...shared,
      "one.test.js": `${head}
      test("the test stores", () => {
        require.cache["os"] = { exports: { platform: 1 } };
        console.log("stored:", typeof require("os").platform, require("pk").os(), typeof require("node:os").platform, require("pk").url());
        delete require.cache["os"];
        console.log("taken out:", typeof require("os").platform, require("pk").os());
      });`,
    },
    printed: ["stored: number number function function", "taken out: function function"],
    results: ["pass the test stores"],
  },

  "one of Bun's own names, and a package that holds the module": {
    files: {
      ...sharedWithWs,
      "one.test.js": `${head}
      test("the test stores", () => {
        const key = Buffer.from("7773", "hex").toString();
        require.cache[key] = { exports: { WebSocket: 1 } };
        console.log("stored:", typeof require("ws").WebSocket, require("pk").ws(), require("pk").url());
        delete require.cache[key];
        console.log("taken out:", typeof require("ws").WebSocket, require("pk").ws());
      });`,
    },
    printed: ["stored: number number function", "taken out: function function"],
    results: ["pass the test stores"],
  },

  "one of Bun's own names that the test spells, and a package that holds the module": {
    files: {
      ...sharedWithWs,
      "one.test.js": `${head}
      test("the test stores", () => {
        require.cache["ws"] = { exports: { WebSocket: 1 } };
        console.log("stored:", typeof require("ws").WebSocket, require("pk").ws(), require("pk").url());
        delete require.cache["ws"];
        console.log("taken out:", typeof require("ws").WebSocket, require("pk").ws());
      });`,
    },
    printed: ["stored: number number function", "taken out: function function"],
    results: ["pass the test stores"],
  },

  "Reflect.set, Object.assign and Object.defineProperty": {
    files: {
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
    // Plain Bun does not see the entry that Object.defineProperty stores. Node.js does, and prints number for `events` too.
    printed: [
      "stored: number number function number number function",
      "taken out: function function function function function function",
    ],
    results: ["pass calls that store"],
  },

  "Module._cache and a name that holds the table": {
    files: {
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
    printed: ["stored: number number number number function", "taken out: function function function function"],
    results: ["pass other ways to the table"],
  },

  "stores that no require() of a spelled name finds": {
    files: {
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
    printed: [
      "stored: number number function",
      "falsy: function function",
      "with node: function function",
      "no module: true",
      "only with node: function",
    ],
    results: ["pass they go through"],
  },
};

// How a compiled run says that it is built. A Bun that loads one program a realm (macOS, Windows, a hardened build) has no
// layers.
const oneRealm = "this Bun loads one program a realm";
const oneProgram = new RegExp(`^one program(: ${oneRealm})? \\| test files 1$`);
type Way = { env: Record<string, string>; form: RegExp };
const asOneProgram: Way = { env: { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:0" }, form: oneProgram };
const ways: [string, Way][] = [
  ["as one program", asOneProgram],
  [
    "in layers",
    {
      env: { BUN_DEBUG_TEST_AOT_WORDS: "TestRunLayers:2,TestRunPartFiles:1" },
      form: new RegExp(`^(layers 2|programs without layers: ${oneRealm}) \\| test files 1 \\| to a program 1( \\||$)`),
    },
  ],
  [
    "with the test files from disk",
    {
      // The word changes nothing: with it a compiled run says how it is built.
      env: {
        BUN_AOT_TEST_FILES_FROM_DISK: "1",
        BUN_AOT_TESTS_NAME_WHAT_THEY_USE: "1",
        BUN_DEBUG_TEST_AOT_WORDS: "TestRunSaysItsForm",
      },
      form: oneProgram,
    },
  ],
];

async function runTests(directory: string, env: Record<string, string> = {}, ...flags: string[]) {
  const command = [bunExe(), "test", "--isolate", ...flags];
  const { stdout, stderr, exitCode } = await run(command, directory, { ...bunEnv, ...env });
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash prints only there.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return {
    stderr,
    /** Plain `bun test` says nothing of the kind, and neither does a Bun that takes `--aot` and compiles nothing. */
    form: [...stderr.matchAll(/^AOT test run \| ((?:one program|layers|programs without layers)\b.*)$/gm)].map(
      match => match[1],
    ),
    /** What plain `bun test` and a compiled run agree in. */
    said: {
      printed: stdout.split("\n").filter(line => line && !line.startsWith("bun test ")),
      errors: stderr.split("\n").filter(line => line.startsWith("error")),
      results: results.sort(),
      ran: stderr.match(/^Ran \d+ tests? across \d+ files?\./m)?.[0],
      exitCode,
    },
  };
}
type Said = Awaited<ReturnType<typeof runTests>>["said"];

const passing = ({ printed, results }: Pick<Project, "printed" | "results">): Said => ({
  printed,
  errors: [],
  results,
  ran: "Ran 1 test across 1 file.",
  exitCode: 0,
});

const plainRuns = new Map<string, Promise<Said>>();
/** Plain `bun test` in a project of its own: once, however many compiled runs are compared with it. */
function plainRun(name: string) {
  return plainRuns.getOrInsertComputed(name, async () => {
    using dir = tempDir("a-key-of-require-cache-that-is-put-together", projects[name].files);
    return (await runTests(String(dir))).said;
  });
}

const toldByScan = Object.keys(projects).slice(0, 6);

for (const [name, project] of Object.entries(projects)) {
  for (const [way, { env, form }] of toldByScan.includes(name) ? ways : ways.slice(0, 1)) {
    test.concurrent(`${name}, ${way}`, async () => {
      const plain = await plainRun(name);
      expect(plain).toEqual(passing(project));
      using dir = tempDir("a-key-of-require-cache-that-is-put-together", project.files);
      const compiled = await runTests(String(dir), env, "--aot");
      expect({ form: compiled.form, ...compiled.said }).toEqual({ form: [expect.stringMatching(form)], ...plain });
    });
  }
}

const logged = (stderr: string) => ({
  // The log is on: only then does the absence of a line about a key say that the key names no module.
  scanned: /^AOT test run \| scan of \d+ files? /m.test(stderr),
  opens: [
    ...new Set(
      [
        ...stderr.matchAll(
          /^AOT test run \| an entry in require\.cache may answer require\(\) of (\d+) modules of the library/gm,
        ),
      ].map(match => Number(match[1])),
    ),
  ],
});

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
    const plain = (await runTests(String(dir))).said;
    expect(plain).toEqual(passing({ printed: [stored], results: ["pass the store"] }));
    const { env, form } = asOneProgram;
    const compiled = await runTests(String(dir), { ...env, BUN_JSC_logAOTPhaseTimes: "1" }, "--aot");
    expect({ form: compiled.form, ...compiled.said }).toEqual({ form: [expect.stringMatching(form)], ...plain });
    expect(logged(compiled.stderr)).toEqual({ scanned: true, opens });
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
  const { env, form } = asOneProgram;
  const compiled = await runTests(String(dir), env, "--aot");
  expect({ form: compiled.form, ...compiled.said }).toEqual({
    form: [expect.stringMatching(form)],
    ...passing({
      printed: ["Cannot store an entry under 'url' in require.cache function"],
      results: ["pass the file stores"],
    }),
  });
});
