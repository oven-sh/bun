import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

const load = `
  export const load = async (label, path) => {
    try {
      console.log(label, (await import(path)).read());
    } catch (error) {
      console.log(label, "threw", error.name, error.message.replace(/'[^']*[\\\\/]src[\\\\/]/, "'src/"));
    }
  };`;

const files = {
  "package.json": `{ "name": "a-name-that-only-a-mock-has-is-imported-by-name" }`,
  "load.js": load,
  "src/other.js": `export const v = "real v"; export function f() {} export default "real default";`,
  "src/barrel.js": `export * from "./other.js"; export const own = "own";`,
  "src/outer.js": `export * from "./barrel.js";`,
  "src/direct.js": `import { v, extra } from "./other.js"; export const read = () => v + " " + extra;`,
  "src/renamed.js": `import { extra as mine } from "./other.js"; let calls = 0; export const read = () => [mine, typeof mine, ++calls, (() => mine)()].join(" ");`,
  "src/through-one.js": `import { v, extra, own } from "./barrel.js"; export const read = () => v + " " + extra + " " + own;`,
  "src/through-two.js": `import { extra } from "./outer.js"; export const read = () => extra;`,
  "src/calls.js": `import { who } from "./other.js"; export const read = () => [typeof who, who(), who.call(7), (0, who)()].join(" ");`,
  "src/calls-through.js": `import { who } from "./barrel.js"; export const read = () => [typeof who, who(), new (class { m() { return who(); } })().m()].join(" ");`,
  "src/hands-on.js": `export { extra } from "./other.js"; export { extra as again } from "./barrel.js";`,
  "src/handed-on.js": `import { extra, again } from "./hands-on.js"; import * as N from "./hands-on.js"; export const read = () => [extra, again, Object.keys(N).join()].join(" ");`,
  "src/with-default.js": `import fallback, { extra, v } from "./other.js"; export const read = () => [fallback, extra, v].join(" ");`,
  "src/places.js": `
    import { extra } from "./other.js";
    class C { field = extra; static s = extra; }
    const later = (x = extra) => x;
    export const read = () => [new C().field, C.s, later(), [1].map(() => extra)[0], \`\${extra}\`, { extra }.extra, typeof extra].join(" ");`,
  "src/stores.js": `import { extra } from "./other.js"; export const read = () => { try { extra = 1; } catch (error) { return error.name + " " + extra; } return "stored"; };`,
  "src/constructs.js": `import { Made } from "./other.js"; export const read = () => [new Made(3).n, new Made(4) instanceof Made, new (class extends Made {})(5).n].join(" ");`,
  "src/typed.ts": `import { extra } from "./other.js"; export const read = (): string => extra as string;`,
  "src/nobody.js": `import { nobody } from "./other.js"; export const read = () => nobody;`,
  "src/nobody-through.js": `import { nobody } from "./outer.js"; export const read = () => nobody;`,
  "ahead.test.js": `
    import { test, mock } from "bun:test";
    import { load } from "./load.js";
    test("the mock gives the name", async () => {
      mock.module("./src/other.js", () => ({
        v: "mocked v",
        extra: "extra",
        default: "mocked default",
        who() { "use strict"; return this === undefined ? "undefined" : typeof this; },
        Made: class Made { constructor(n) { this.n = n; } },
      }));
      await load("direct", "./src/direct.js");
      await load("renamed", "./src/renamed.js");
      await load("through one star", "./src/through-one.js");
      await load("through two stars", "./src/through-two.js");
      await load("a function is called", "./src/calls.js");
      await load("a function is called, through a star", "./src/calls-through.js");
      await load("an export statement hands it on", "./src/handed-on.js");
      await load("beside the default", "./src/with-default.js");
      await load("where a name can stand", "./src/places.js");
      await load("a store", "./src/stores.js");
      await load("a class", "./src/constructs.js");
      await load("from TypeScript", "./src/typed.ts");
      await load("a name that nobody gives", "./src/nobody.js");
      await load("a name that nobody gives, through stars", "./src/nobody-through.js");
      mock.module("./src/other.js", () => ({ v: "again", extra: "extra again" }));
      await load("behind a second mock", "./src/places.js");
      await load("behind a second mock, through a star", "./src/through-one.js");
    });`,
  "lacks.test.js": `
    import { test, mock } from "bun:test";
    import { load } from "./load.js";
    test("the mock does not give the name", async () => {
      mock.module("./src/other.js", () => ({ v: "mocked v" }));
      await load("direct", "./src/direct.js");
      await load("through one star", "./src/through-one.js");
      await load("through two stars", "./src/through-two.js");
    });`,
  "none.test.js": `
    import { test } from "bun:test";
    import { load } from "./load.js";
    test("no mock in this file", async () => {
      await load("direct", "./src/direct.js");
      await load("through one star", "./src/through-one.js");
      await load("through two stars", "./src/through-two.js");
      await load("a name that nobody gives", "./src/nobody.js");
    });`,
};

async function printedBy(directory: string, words: string, ...flags: string[]) {
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words };
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", "--isolate", ...flags], directory, env);
  if (exitCode !== 0) console.error(stderr);
  return { printed: stdout.replace(/^bun test .*\n/, ""), exitCode };
}

test.each([
  ["as one program", "TestRunLayers:0"],
  ["over two layers", "TestRunLayers:2,TestRunPartFiles:1"],
])("%s", async (_, words) => {
  using directory = tempDir("a-name-that-only-a-mock-has-is-imported-by-name", files);
  const plain = await printedBy(String(directory), words);
  expect(plain.printed).toContain("direct mocked v extra\n");
  expect(plain.printed).toContain("through two stars extra\n");
  expect(plain.printed).toContain("a function is called function undefined number undefined\n");
  expect(plain.printed).toContain("a store TypeError extra\n");
  expect(plain.printed).toContain("a name that nobody gives threw SyntaxError");
  expect(plain.printed).toContain("a name that nobody gives undefined\n");
  expect(await printedBy(String(directory), words, "--aot")).toEqual(plain);
});
