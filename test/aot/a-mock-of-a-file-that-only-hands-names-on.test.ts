import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

// index.js of a package only hands names on. Compiled importers are bound past it and its body, which has no code, never runs, so its status says nothing of whether it is loaded.
// Plain Bun has loaded it with the first module that imports it: a mock then replaces the names that its factory gives and keeps the rest.
// Where nothing has imported it, the mock stands for the whole file, and the files behind it are as they were.
const handsOn = `export { a } from "./a.js"; export { b } from "./b.js";
export * from "./c.js";
import { d } from "./d.js";
export { d };
export { default as e } from "./e.js";
`;
const packageFiles = (name: string, more: string) => ({
  [`node_modules/${name}/package.json`]: `{ "name": "${name}", "version": "1.0.0", "type": "module", "main": "index.js"${more} }`,
  [`node_modules/${name}/index.js`]: handsOn,
  ...Object.fromEntries(
    ["a", "b", "c", "d"].map(f => [
      `node_modules/${name}/${f}.js`,
      `export function ${f}() { return "${f} of ${name}"; }\n`,
    ]),
  ),
  [`node_modules/${name}/e.js`]: `export default function e() { return "e of ${name}"; }\n`,
});
const testFile = `import { test, mock } from "bun:test";
import { use, later } from "./src/user.js";
const note = (...parts) => console.log("SEEN", ...parts);
const said = ask => { try { return ask(); } catch (error) { return "threw " + error.name + ": " + error.message.slice(0, 60); } };
test("a mock that gives one name of a package that src has imported", async () => {
  note("before", said(use));
  mock.module("quiet", () => ({ a: () => "mocked a" }));
  mock.module("loud", () => ({ a: () => "mocked a" }));
  note("behind the mocks", said(use));
  const late = await later();
  note("a file of src that is loaded later", said(late.useB));
  const quiet = await import("quiet"), loud = await import("loud");
  note("the namespaces", Object.keys(quiet).join(), typeof quiet.b, Object.keys(loud).join(), typeof loud.b);
});
test("a mock of a package that nothing has imported leaves the files behind it alone", async () => {
  mock.module("unseen", () => ({ a: () => "mocked a" }));
  const unseen = await import("unseen");
  note("the mock", Object.keys(unseen).join(), unseen.a(), typeof unseen.d);
  const [b, c, d, e] = [await import("unseen/b.js"), await import("unseen/c.js"), await import("unseen/d.js"), await import("unseen/e.js")];
  note("the files", said(() => [b.b(), c.c(), d.d(), e.default()].join()));
});
`;

test("it says what plain Bun says, as one program and in two layers", async () => {
  using dir = tempDir("aot-mock-of-a-file-that-hands-names-on", {
    "package.json": `{ "name": "p", "type": "module" }`,
    "tsconfig.json": `{}`,
    ...packageFiles("quiet", `, "sideEffects": false`),
    ...packageFiles("loud", ""),
    ...packageFiles("unseen", ""),
    "src/user.js": `import { a, b, c } from "quiet";
import { a as loudA, b as loudB, c as loudC } from "loud";
export const use = () => [a(), b(), c(), loudA(), loudB(), loudC()].join();
export const later = () => import("./late.js");
`,
    "src/late.js": `import { b, c, d, e } from "quiet";
import { b as loudB, c as loudC, d as loudD, e as loudE } from "loud";
const ask = f => (typeof f === "function" ? f() : typeof f);
export const useB = () => [b, c, d, e, loudB, loudC, loudD, loudE].map(ask).join();
`,
    "one.test.js": testFile,
    "two.test.js": testFile,
  });
  const seen = async (flags: string[], words: string) => {
    const { stdout, stderr } = await run([bunExe(), "test", ...flags, "--isolate"], String(dir), {
      ...bunEnv,
      BUN_DEBUG_TEST_AOT_WORDS: words,
    });
    return (stdout + "\n" + stderr).split("\n").filter(line => line.startsWith("SEEN"));
  };
  const plain = await seen([], "");
  expect(plain.length).toBe(12);
  expect(plain).toContain("SEEN the files b of unseen,c of unseen,d of unseen,e of unseen");
  expect(await seen(["--aot"], "TestRunLayers:0")).toEqual(plain);
  expect(await seen(["--aot"], "TestRunLayers:2,TestRunPartFiles:1")).toEqual(plain);
}, 600000);
