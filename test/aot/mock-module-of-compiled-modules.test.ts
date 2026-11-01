import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { describe } from "./harness/declare";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const greet = {
  "greet.ts": `
    export function greet(name: string): string { return "hello " + name; }
    export function greetTwice(name: string): string { return greet(name) + ", " + greet(name); }
    export const mark = "!";
    export default function farewell(name: string): string { return "bye " + name; }`,
  "user.ts": `
    import farewell, { greet, greetTwice, mark } from "./greet";
    import * as all from "./greet";
    export const show = () => console.log(greet("a"), "|", greetTwice("b"), "|", mark, "|", farewell("c"), "|", all.greet("d"));`,
};

async function runTests(directory: string, ...flags: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags], directory, bunEnv);
  const results = [...stderr.matchAll(/^\((pass|fail)\) (.*?)(?: \[.*\])?$/gm)].map(match => `${match[1]} ${match[2]}`);
  // A crash prints only there, and the comparison below would hide it.
  if (exitCode !== 0 && exitCode !== 1) console.error(stderr);
  return { stdout, results, exitCode };
}

async function expectCompiledToRunAsPlain(files: Record<string, string>, ...flags: string[]) {
  using dir = tempDir("mock-module-of-compiled-modules", files);
  const plain = await runTests(String(dir), ...flags);
  expect(plain.results.filter(result => result.startsWith("fail"))).toEqual([]);
  expect(plain.results).not.toEqual([]);
  expect(await runTests(String(dir), "--debug-aot", ...flags)).toEqual(plain);
}

test("mock.module replaces the exports of a module that is loaded", async () => {
  await expectCompiledToRunAsPlain({
    ...greet,
    "one.test.ts": `
      import { mock, test } from "bun:test";
      import { show } from "./user";
      test("before", show);
      test("mocked", async () => {
        mock.module("./greet", () => ({ greet: (name: string) => "MOCK " + name, mark: "?", default: () => "MOCK bye" }));
        show();
        const again = await import("./greet");
        console.log(again.greet("e"), again.mark, again.default("f"), again.greetTwice("g"));
      });
      test("mock.restore() leaves it", () => { mock.restore(); show(); });
      test("mocked again", () => { mock.module("./greet", () => ({ greet: () => "second" })); show(); });`,
  });
});

test("jest.mock and vi.mock replace the exports of a module", async () => {
  await expectCompiledToRunAsPlain({
    ...greet,
    "other.ts": `export const other = () => "other";`,
    "one.test.ts": `
      import { jest, test, vi } from "bun:test";
      import { other } from "./other";
      import { show } from "./user";
      test("jest", () => { jest.mock("./greet", () => ({ greet: () => "jest" })); show(); });
      test("vi", () => { vi.mock("./other", () => ({ other: () => "vi" })); console.log(other()); });`,
  });
});

test("mock.module with a factory that returns a promise", async () => {
  await expectCompiledToRunAsPlain({
    ...greet,
    "one.test.ts": `
      import { mock, test } from "bun:test";
      import { show } from "./user";
      test("mocked", async () => {
        await mock.module("./greet", async () => { await Promise.resolve(); return { greet: () => "later" }; });
        show();
      });`,
  });
});

test("mock.module replaces the names of a node: module and of a CommonJS file", async () => {
  await expectCompiledToRunAsPlain({
    "legacy.cjs": `exports.version = function () { return "real"; };`,
    "user.ts": `
      import { hostname, platform } from "node:os";
      import { version } from "./legacy.cjs";
      export const show = () => console.log(typeof hostname(), hostname() === "mocked", typeof platform(), version());`,
    "one.test.ts": `
      import { mock, test } from "bun:test";
      import { show } from "./user";
      test("mocked", () => {
        show();
        mock.module("node:os", () => ({ hostname: () => "mocked" }));
        mock.module("./legacy.cjs", () => ({ version: () => "mocked" }));
        show();
      });`,
  });
});

test("a mock may give a name that the ES module does not export", async () => {
  await expectCompiledToRunAsPlain(
    {
      "m.ts": `export const a: number = 1;\nexport function f(): number { return 1; }`,
      "preload.ts": `
      import { mock } from "bun:test";
      mock.module("./m", () => ({ a: 2, f: () => 2, extra: 3 }));`,
      "one.test.ts": `
      import { test } from "bun:test";
      import { a, f } from "./m";
      test("mocked", () => console.log(a, f()));`,
    },
    "--preload",
    "./preload.ts",
  );
});

test("a node: module that is mocked before it is loaded answers import() with the mock's names", async () => {
  await expectCompiledToRunAsPlain({
    "one.test.ts": `
      import { mock, test } from "bun:test";
      const mine = (): string => "mocked";
      mock.module("node:os", () => ({ platform: mine }));
      test("mocked", async () => {
        const loaded = (await import("node:os")) as unknown as { platform: unknown };
        console.log(loaded.platform === mine);
      });`,
  });
});

test("a module that is mocked before it is loaded never runs, and neither does what only it imports", async () => {
  await expectCompiledToRunAsPlain(
    {
      "deep.ts": `console.log("deep runs");\nexport const deep = "deep";`,
      "shared.ts": `console.log("shared runs");\nexport const shared = "shared";`,
      "real.ts": `
        import { deep } from "./deep";
        import { shared } from "./shared";
        console.log("real runs");
        export const value = "real " + deep + shared;
        export function read(): string { return value; }`,
      "user.ts": `
        import { read, value } from "./real";
        import { shared } from "./shared";
        export const show = () => console.log(read(), value, shared);`,
      "preload.ts": `
        import { mock } from "bun:test";
        mock.module("./real", () => ({ value: "mocked", read: () => "mocked read" }));`,
      "a.test.ts": `import { test } from "bun:test";\nimport { show } from "./user";\ntest("a", show);`,
      "b.test.ts": `import { test } from "bun:test";\nimport { show } from "./user";\ntest("b", show);`,
    },
    "--preload",
    "./preload.ts",
  );
});

describe("constants, classes, enums and references kept from before the mock", () => {
  const files = {
    "a.ts": `
      export const LIMIT = 5;
      export function add(n: number): number { return n + 1; }
      export function twice(n: number): number { return add(n) * 2; }
      export class Shape { name(): string { return "real"; } static make(): Shape { return new Shape(); } }
      export enum Color { Red = "red" }`,
    "user.ts": `
      import { LIMIT, add, twice, Shape, Color } from "./a";
      const kept = add;
      class Square extends Shape {}
      export const all = (): string =>
        [LIMIT, LIMIT === 5, add(1), add(...[1]), kept(1), twice(1), new Shape().name(), new Square().name(), Shape.make().name(), Color.Red].join();`,
  };
  const header = `import { mock, test } from "bun:test";\n`;
  const lay = `mock.module("./a", () => ({ LIMIT: 6, add: (n: number) => n + 100, twice: (n: number) => n, Shape: class { name() { return "mocked"; } static make() { return new this(); } }, Color: { Red: "mocked red" } }));\n`;

  test("mocked before the tests", async () => {
    await expectCompiledToRunAsPlain({
      ...files,
      "main.test.ts": `${header}import { all } from "./user";\n${lay}test("case", () => { console.log(all()); });`,
    });
  });
  test("mocked inside a test", async () => {
    await expectCompiledToRunAsPlain({
      ...files,
      "main.test.ts": `${header}import { all } from "./user";\ntest("case", () => { console.log(all()); ${lay} console.log(all()); });`,
    });
  });
  test("mocked in a preload", async () => {
    await expectCompiledToRunAsPlain(
      {
        ...files,
        "pre.ts": `import { mock } from "bun:test";\n${lay}`,
        "main.test.ts": `${header}import { all } from "./user";\ntest("case", () => { console.log(all()); });`,
      },
      "--preload",
      "./pre.ts",
    );
  });
  test("mocked ahead of an import()", async () => {
    await expectCompiledToRunAsPlain({
      ...files,
      "main.test.ts": `${header}${lay}test("case", async () => { const { all } = await import("./user"); console.log(all()); });`,
    });
  });
  test("mocked in the first of two files", async () => {
    await expectCompiledToRunAsPlain({
      ...files,
      "first.test.ts": `${header}import { all } from "./user";\ntest("first", () => { ${lay} console.log(all()); });`,
      "second.test.ts": `${header}import { all } from "./user";\ntest("second", () => { console.log(all()); });`,
    });
  });
});

test("a constant that a mocked file exports again is mocked for those who import it from its origin", async () => {
  await expectCompiledToRunAsPlain({
    "origin.ts": `export const LIMIT = 5;\nexport const DEEP = "deep";\nexport const KEPT = 1;`,
    "middle.ts": `export * from "./origin";`,
    "barrel.ts": `export { LIMIT } from "./origin";\nexport { DEEP } from "./middle";\nimport { KEPT } from "./origin";\nexport const own = KEPT + 1;`,
    "user.ts": `
      import { DEEP, KEPT, LIMIT } from "./origin";
      export const show = () => console.log(LIMIT, LIMIT === 5, DEEP, DEEP === "deep" ? "folded" : "read", KEPT === 1);`,
    "one.test.ts": `
      import { mock, test } from "bun:test";
      import { show } from "./user";
      test("mocked", () => {
        show();
        mock.module("./barrel", () => ({ LIMIT: 6, DEEP: "mocked", own: 0 }));
        show();
      });`,
  });
});

describe("a module that Bun answers with a built-in of its own", () => {
  const user = {
    "user.ts": `
      import WebSocket, { WebSocketServer } from "ws";
      import os, { hostname } from "node:os";
      import * as osAll from "node:os";
      export const show = () =>
        console.log(WebSocket.name, typeof WebSocketServer, typeof os.hostname === "function" ? os.hostname() === "mocked" : typeof os.hostname, hostname() === "mocked", osAll.hostname() === "mocked", osAll.default === os);`,
    "one.test.ts": `import { test } from "bun:test";\nimport { show } from "./user";\ntest("one", show);`,
    "two.test.ts": `import { test } from "bun:test";\nimport { show } from "./user";\ntest("two", show);`,
  };

  test("a helper of the preload wraps the default export, which is loaded by then", async () => {
    await expectCompiledToRunAsPlain(
      {
        ...user,
        "guard.ts": `
          import { mock } from "bun:test";
          import * as all from "ws";
          const Real = all.default;
          class Guarded extends Real {}
          export function guard(): void {
            console.log(all.default === Real ? "real" : "guarded");
            if (all.default === Real) void mock.module("ws", () => ({ ...all, default: Guarded, WebSocket: Guarded }));
          }`,
        "preload.ts": `import { beforeEach } from "bun:test";\nimport { guard } from "./guard";\nguard();\nbeforeEach(() => { guard(); });`,
      },
      "--preload",
      "./preload.ts",
    );
  });

  test("a preload mocks it before anything has loaded it", async () => {
    await expectCompiledToRunAsPlain(
      {
        ...user,
        "preload.ts": `
          import { mock } from "bun:test";
          mock.module("ws", () => ({ default: function MockSocket() {}, WebSocketServer: 1 }));
          mock.module("node:os", () => ({ default: { hostname: () => "mocked" }, hostname: () => "mocked" }));`,
      },
      "--preload",
      "./preload.ts",
    );
  });
});

test("a mock answers for a package and a file that exist nowhere", async () => {
  await expectCompiledToRunAsPlain(
    {
      "tsconfig.json": `{ "compilerOptions": { "noImplicitAny": false } }`,
      "preload.ts": `
        import { mock } from "bun:test";
        mock.module("not-installed-a", () => ({ value: "from the preload" }));`,
      "folder/user.ts": `
        // @ts-ignore
        import { value } from "not-installed-a";
        export const show = () => console.log(value);`,
      "one.test.ts": `
        import { mock, test } from "bun:test";
        import { show } from "./folder/user";
        test("static", show);
        test("import()", async () => {
          mock.module("not-installed-b", () => ({ value: 1 }));
          // @ts-ignore
          console.log((await import("not-installed-b")).value);
        });
        test("require", () => {
          mock.module("not-installed-c", () => ({ value: 2 }));
          // @ts-ignore
          console.log(require("not-installed-c").value);
        });
        test("a file", async () => {
          mock.module("./not-there", () => ({ value: 3 }));
          // @ts-ignore
          console.log((await import("./not-there")).value);
        });`,
    },
    "--preload",
    "./preload.ts",
  );
});

test("a mock answers for packages that exist nowhere, named by an application file and by an installed package", async () => {
  await expectCompiledToRunAsPlain({
    "tsconfig.json": `{ "compilerOptions": { "noImplicitAny": false } }`,
    "node_modules/installed/package.json": `{ "name": "installed", "main": "index.js" }`,
    "node_modules/installed/index.js": `module.exports = { value: require("optional-native").value };`,
    "folder/user.ts": `
      // @ts-ignore
      import fallback from "not-installed-d";
      // @ts-ignore
      import * as all from "@scope/not-installed/sub/path.js";
      export const show = () => console.log(fallback, Object.keys(all).join());
      // @ts-ignore
      export const later = async () => console.log((await import("./gone/file.ts")).value);`,
    "one.test.ts": `
      import { jest, mock, test, vi } from "bun:test";
      mock.module("not-installed-d", () => ({ default: "d" }));
      mock.module("@scope/not-installed/sub/path.js", () => ({ one: 1, two: 2 }));
      mock.module("./folder/gone/file.ts", () => ({ value: "gone" }));
      mock.module("optional-native", () => ({ value: "native" }));
      test("an application file", async () => {
        const { show, later } = await import("./folder/user");
        show();
        await later();
      });
      test("an installed package", () => console.log(require("installed").value));
      test("a name made at run time", async () => {
        const name = ["not", "installed", "e"].join("-");
        mock.module(name, () => ({ value: "e" }));
        console.log((await import(name)).value, require(name).value);
      });
      test("jest.mock and vi.mock", async () => {
        (jest as any).mock("not-installed-f", () => ({ value: "f" }));
        vi.mock("not-installed-g", () => ({ value: "g" }));
        // @ts-ignore
        console.log((await import("not-installed-f")).value, (await import("not-installed-g")).value);
      });
      test("without a mock", async () => {
        // @ts-ignore
        await import("not-installed-h").catch(error => console.log(error.name, error.code));
        try {
          require("not-installed-i");
        } catch (error) {
          console.log(error.name, error.code);
        }
      });`,
  });
});

test("a CommonJS file and a library module that only a mocked module imports never run", async () => {
  await expectCompiledToRunAsPlain(
    {
      "dep.cjs": `console.log("dep.cjs runs");\nexports.dep = "dep";`,
      "nested.cjs": `console.log("nested.cjs runs");\nexports.nested = "nested";`,
      "shared.cjs": `console.log("shared.cjs runs");\nexports.shared = "shared";`,
      "inner.ts": `import { nested } from "./nested.cjs";\nconsole.log("inner.ts runs");\nexport const inner = nested;`,
      "data.json": `{ "value": 1 }`,
      "real.ts": `
        import { dep, absent } from "./dep.cjs";
        import { inner } from "./inner";
        import { shared } from "./shared.cjs";
        import data from "./data.json";
        import { EventEmitter } from "node:events";
        console.log("real.ts runs");
        export const value = [dep, absent, inner, shared, data.value, typeof EventEmitter].join();`,
      "user.ts": `
        import { value } from "./real";
        import { shared } from "./shared.cjs";
        export const show = () => console.log(value, shared);`,
      "preload.ts": `
        import { mock } from "bun:test";
        mock.module("./real", () => ({ value: "mocked" }));`,
      "a.test.ts": `import { test } from "bun:test";\nimport { show } from "./user";\ntest("a", show);`,
      "b.test.ts": `import { test } from "bun:test";\nimport { show } from "./user";\ntest("b", show);`,
    },
    "--preload",
    "./preload.ts",
  );
});

test("what never runs goes by the mocks of each file, whatever the file before it mocked", async () => {
  const mocking = (...names: string[]) => `
    import { mock, test } from "bun:test";
    ${names.map(name => `mock.module("./${name}", () => ({ ${name}: "mock ${name}" }));`).join("\n")}
    const { show } = await import("./user");
    test("shows", show);`;
  await expectCompiledToRunAsPlain(
    {
      "only.cjs": `console.log("only.cjs runs");\nexports.only = "only";`,
      "deep.cjs": `console.log("deep.cjs runs");\nexports.deep = "deep";`,
      "left.cjs": `console.log("left.cjs runs");\nexports.left = "left";`,
      "right.cjs": `console.log("right.cjs runs");\nexports.right = "right";`,
      "always.ts": `import { only } from "./only.cjs";\nconsole.log("always.ts runs");\nexport const always = only;`,
      "one.ts": `import { deep } from "./deep.cjs";\nimport { left } from "./left.cjs";\nconsole.log("one.ts runs");\nexport const one = deep + left;`,
      "two.ts": `import { deep } from "./deep.cjs";\nimport { right } from "./right.cjs";\nconsole.log("two.ts runs");\nexport const two = deep + right;`,
      "late.ts": `import { two } from "./two";\nconsole.log("late.ts runs");\nexport const late = two;`,
      "user.ts": `
        import { always } from "./always";
        import { one } from "./one";
        import { two } from "./two";
        export const show = () => console.log(always, one, two, require("./late").late);`,
      "preload.ts": `
        import { mock } from "bun:test";
        mock.module("./always", () => ({ always: "mock always" }));`,
      "a.test.ts": mocking("one"),
      "b.test.ts": mocking("two"),
      "c.test.ts": mocking(),
      "d.test.ts": mocking("one", "two"),
      "e.test.ts": mocking("one"),
      "f.test.ts": mocking("two", "one"),
    },
    "--isolate",
    "--preload",
    "./preload.ts",
  );
});

test("the factory of a module that has not loaded runs at the first import", async () => {
  await expectCompiledToRunAsPlain(
    {
      "real.ts": `console.log("real runs");\nexport const value = "real";`,
      "late.ts": `console.log("late runs");\nexport const value = "late";`,
      "never.ts": `export const value = "never";`,
      "user.ts": `import { value } from "./real";\nconsole.log("user runs", value);\nexport const show = () => console.log(value);`,
      "preload.ts": `
        import { mock } from "bun:test";
        mock.module("./real", () => { console.log("factory of real"); return { value: "mocked" }; });
        mock.module("./real", () => { console.log("second factory of real"); return { value: "mocked again" }; });
        mock.module("./never", () => { console.log("factory of never"); return { value: "no" }; });
        console.log("preload ends");`,
      "a.test.ts": `
        import { mock, test } from "bun:test";
        console.log("a runs");
        import { show } from "./user";
        test("static", show);
        test("import()", async () => {
          mock.module("./late", () => { console.log("factory of late"); return { value: "mocked late" }; });
          console.log("before the import");
          console.log((await import("./late")).value);
        });
        test("require", () => {
          mock.module("./required", () => { console.log("factory of required"); return { value: "mocked required" }; });
          console.log("before the require");
          console.log(require("./required").value);
        });`,
      "required.ts": `console.log("required runs");\nexport const value = "required";`,
      "b.test.ts": `
        import { test } from "bun:test";
        import { show } from "./user";
        test("again", show);`,
    },
    "--preload",
    "./preload.ts",
  );
});

test("the graph waits for an async factory of a module that has not loaded", async () => {
  await expectCompiledToRunAsPlain(
    {
      "real.ts": `export const value = "real";`,
      "user.ts": `import { value } from "./real";\nexport const atLoad = value;`,
      "preload.ts": `
        import { mock } from "bun:test";
        mock.module("./real", async () => { await Bun.sleep(20); return { value: "mocked later" }; });`,
      "a.test.ts": `
        import { test } from "bun:test";
        import { atLoad } from "./user";
        test("read at load", () => { console.log(atLoad); });`,
    },
    "--preload",
    "./preload.ts",
  );
});

test("a module that is imported for its side effects alone is mocked", async () => {
  await expectCompiledToRunAsPlain(
    {
      "effect.ts": `console.log("effect.ts runs");\n(globalThis as any).effect = "real";`,
      "effect.cjs": `console.log("effect.cjs runs");\nglobalThis.effectOfFile = "real";`,
      "preload.ts": `
        import { mock } from "bun:test";
        mock.module("./effect", () => ({}));
        mock.module("./effect.cjs", () => ({}));`,
      "one.test.ts": `
        import { test } from "bun:test";
        import "./effect";
        import "./effect.cjs";
        test("one", () => { console.log((globalThis as any).effect, (globalThis as any).effectOfFile); });`,
    },
    "--preload",
    "./preload.ts",
  );
});

test("a mock under a path that the build can't know replaces any module", async () => {
  await expectCompiledToRunAsPlain({
    ...greet,
    "limit.ts": `export const LIMIT = 5;`,
    "mocker.ts": `
      import { mock } from "bun:test";
      export class Mocker {
        #undo: (() => void)[] = [];
        mock(path: string, original: object, mocks: object) {
          mock.module(path, () => ({ ...original, ...mocks }));
          this.#undo.push(() => { mock.module(path, () => original); });
        }
        clear() { for (const undo of this.#undo.splice(0)) undo(); }
      }`,
    "one.test.ts": `
      import { test } from "bun:test";
      import { hostname } from "node:os";
      import * as greet from "./greet";
      import { LIMIT } from "./limit";
      import { Mocker } from "./mocker";
      import { show } from "./user";
      const paths = JSON.parse('["/greet.ts", "/limit.ts", "node:os"]');
      test("mocked and cleared", () => {
        const mocker = new Mocker();
        mocker.mock(import.meta.dir + paths[0], { ...greet }, { greet: () => "computed" });
        mocker.mock(import.meta.dir + paths[1], { LIMIT }, { LIMIT: 6 });
        mocker.mock(paths[2], { hostname }, { hostname: () => "mocked" });
        show();
        console.log(LIMIT, LIMIT === 5, hostname());
        mocker.clear();
        show();
        console.log(LIMIT, LIMIT === 5, hostname() === "mocked");
      });`,
  });
});

test("require() answers a mocked CommonJS file with the mock's object", async () => {
  await expectCompiledToRunAsPlain(
    {
      "loaded.cjs": `exports.version = function () { return "real"; };`,
      "early.cjs": `console.log("early runs");\nexports.version = function () { return "real"; };`,
      "requirer.cjs": `exports.read = function () { return require("./early.cjs").version() + " " + require("./loaded.cjs").version(); };`,
      "preload.ts": `
        import { mock } from "bun:test";
        mock.module("./early.cjs", () => ({ version: () => "mocked early" }));`,
      "one.test.ts": `
        import { mock, test } from "bun:test";
        import { version as early } from "./early.cjs";
        import whole, { version } from "./loaded.cjs";
        import { read } from "./requirer.cjs";
        test("mocked", () => {
          console.log(read(), early(), version(), whole.version(), require("./loaded.cjs").version());
          mock.module("./loaded.cjs", () => ({ version: () => "mocked" }));
          console.log(read(), early(), version(), whole.version(), require("./loaded.cjs").version());
          mock.module("./loaded.cjs", () => ({ default: { version: () => "mocked default" } }));
          console.log(version(), whole.version());
        });`,
    },
    "--preload",
    "./preload.ts",
  );
});

test("what a mock leaves out of a module that has not loaded reads as undefined", async () => {
  await expectCompiledToRunAsPlain({
    "late.mjs": `
      console.log("the real body runs");
      export const given = () => "real";
      export const leftOut = () => "real";
      export let count = 1;
      export class Thing {}
      export default "real default";`,
    "one.test.ts": `
      import { mock, test } from "bun:test";
      mock.module("./late.mjs", () => ({ given: () => "fake" }));
      test("read through the namespace", async () => {
        const late: any = await import("./late.mjs");
        console.log(late.given(), typeof late.leftOut, typeof late.count, typeof late.Thing, typeof late.default, late.leftOut?.() ?? "nothing");
      });`,
  });
});
