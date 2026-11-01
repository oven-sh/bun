import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { A, B, cases, tree, type Case, type Entry } from "../js/bun/resolve/import-meta-glob-cases";
import { run } from "./harness/run";
import { beforeAll, describe, test } from "./supported";

const env = { ...bunEnv, NO_COLOR: "1" };

type Mode = "an executable" | "bun test --aot" | "bun test --aot over two layers";
const modes: Mode[] = ["an executable", "bun test --aot", "bun test --aot over two layers"];

/** What the file prints, and what the build says. */
async function runFile(root: string, file: string, mode: Mode) {
  if (mode === "an executable") {
    const built = await run([bunExe(), "build", "--compile", "--aot", file, "--outfile", join(root, "app")], root, env);
    expect({ exitCode: built.exitCode, stderr: built.exitCode ? built.stderr : "" }).toEqual({
      exitCode: 0,
      stderr: "",
    });
    const { stdout, stderr, exitCode } = await run([join(root, "app")], root, env);
    return { stdout, stderr, exitCode, build: built.stdout + built.stderr };
  }
  const words = mode === "bun test --aot" ? "TestRunLayers:0" : "TestRunLayers:2,TestRunPartFiles:1";
  const ran = await run([bunExe(), "test", "--aot", file], root, { ...env, BUN_DEBUG_TEST_AOT_WORDS: words });
  return { ...ran, build: ran.stderr };
}

async function evaluate(root: string, rows: Case[], mode: Mode) {
  writeFileSync(
    join(root, "src/main.ts"),
    `import { describeGlob } from "./harness.js";
     export default [\n${rows.map(([code]) => `await describeGlob(${code}),`).join("\n")}\n];`,
  );
  writeFileSync(
    join(root, "print.test.ts"),
    `import results from "./src/main.ts";
     const print = () => console.log("RESULTS" + JSON.stringify(results));
     ${mode === "an executable" ? "print();" : 'test("print", print);'}`,
  );
  const { stdout, stderr, exitCode } = await runFile(root, "./print.test.ts", mode);
  const line = stdout.split("\n").find(line => line.startsWith("RESULTS"));
  expect({ stderr: line ? "" : stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return JSON.parse(line!.slice("RESULTS".length)) as Entry[][];
}

function table(name: string, rows: Case[], files: Record<string, string> = {}) {
  describe.each(modes)(name + ": %s", mode => {
    let actual: Entry[][];
    beforeAll(async () => {
      using directory = tempDir("aot-import-meta-glob", { ...tree, ...files });
      actual = await evaluate(join(String(directory), "proj"), rows, mode);
    }, 480_000);
    test.each(rows.map(([code], i) => [code, i] as const))("%s", (_, i) => {
      expect(actual[i]).toEqual(rows[i][1]);
    });
  });
}

table("the cases of plain Bun", cases);

// prettier-ignore
table('tsconfig.json "paths" and package.json "imports"', [
  ['import.meta.glob("@/dir/[ab].ts")', [["/src/dir/a.ts", "lazy", A], ["/src/dir/b.ts", "lazy", B]]],
  ['import.meta.glob(["@/dir/[ab].ts", "!@/dir/a.ts"])', [["/src/dir/b.ts", "lazy", B]]],
  ['import.meta.glob("@/dir/[ab].ts", { eager: true, import: "name" })', [["/src/dir/a.ts", "eager", "a"], ["/src/dir/b.ts", "eager", "b"]]],
  ['import.meta.glob("#one")', [["/src/dir/a.ts", "lazy", A]]],
  ['import.meta.glob("#dir/**/d.ts")', [["/src/dir/sub/d.ts", "lazy", {"default":"sub/d"}]]],
], { "proj/tsconfig.json": JSON.stringify({ compilerOptions: { paths: { "@/*": ["./src/*"] } } }) });

async function runEntry(name: string, code: string, mode: Mode, files: Record<string, string> = {}) {
  using directory = tempDir("aot-import-meta-glob", { ...tree, ...files, ["proj/src/" + name]: code });
  const ran = await runFile(join(String(directory), "proj"), "./src/" + name, mode);
  return { said: ran.stdout.split("\n").filter(line => line.startsWith("SAID ")), build: ran.build };
}
const inTest = (mode: Mode, code: string) =>
  mode === "an executable" ? code : `import { test } from "bun:test";\ntest("it", async () => {\n${code}\n});`;

describe.concurrent.each(modes)("%s", mode => {
  test("a call that cannot be expanded is named by the build and throws where it is reached", async () => {
    const code = `
      const pattern = "./dir/" + process.argv.length + ".ts";
      const said = (ask: () => unknown) => { try { return Object.keys(ask() as object).join(); } catch (error: any) { return error.constructor.name + ": " + error.message; } };
      console.log("SAID", said(() => import.meta.glob(pattern)));
      console.log("SAID", said(() => import.meta.glob("./dir/a.ts", { eager: 1 as any })));
      console.log("SAID", said(() => import.meta.glob("dir/a.ts")));
      console.log("SAID", said(() => import.meta.glob("./dir/a.ts")));`;
    const messages = [
      "Expected a glob pattern to be a string literal, but got identifier",
      'Expected the "import.meta.glob" option "eager" to be a boolean literal, but got number',
      'Expected a glob pattern to start with "/", "./", "../", "**" or a path alias, but got "dir/a.ts"',
    ];
    const { said, build } = await runEntry("entry.test.ts", inTest(mode, code), mode);
    expect(said).toEqual([...messages.map(message => "SAID TypeError: " + message), "SAID ./dir/a.ts"]);
    for (const message of messages) expect(build).toContain("warn: " + message);
  });

  test("eager entries run before the file that asks for them, in order", async () => {
    const files = {
      "proj/src/order/1.ts": `console.log("SAID 1"); export {};`,
      "proj/src/order/2.ts": `console.log("SAID 2"); export {};`,
      "proj/src/order/own.ts": `console.log("SAID own"); export {};`,
    };
    const code = `
      import "./order/own.ts";
      console.log("SAID body");
      const lazy = import.meta.glob("./dir/a.ts");
      const eager = import.meta.glob("./order/[12].ts", { eager: true });
      console.log("SAID", Object.keys(eager).join(), Object.keys(lazy).join());`;
    const { said } = await runEntry(
      "entry.test.ts",
      code + (mode === "an executable" ? "" : `\ntest("it", () => {});`),
      mode,
      files,
    );
    expect(said).toEqual(["SAID 1", "SAID 2", "SAID own", "SAID body", "SAID ./order/1.ts,./order/2.ts ./dir/a.ts"]);
  });

  test("Object.keys() of the call loads nothing", async () => {
    const files = { "proj/src/loud/l.ts": `console.log("SAID loaded"); export {};` };
    const code = `console.log("SAID", Object.keys(import.meta.glob("./loud/*.ts", { eager: true })).join());`;
    const { said } = await runEntry("entry.test.ts", inTest(mode, code), mode, files);
    expect(said).toEqual(["SAID ./loud/l.ts"]);
  });

  // A bundle turns the import statements of a CommonJS file into calls of `require`. `bun test` transpiles the file by itself.
  test("in a CommonJS file", async () => {
    const body = `
      console.log("SAID", Object.keys(import.meta.glob("./dir/[ab].ts")).join(), typeof module);
      try {
        const eager = import.meta.glob("./dir/[ab].ts", { eager: true, import: "name" });
        console.log("SAID", JSON.stringify(eager));
      } catch (error) {
        console.log("SAID", error.constructor.name + ": " + error.message);
      }`;
    const code =
      mode === "an executable" ? body : `const { test } = require("bun:test");\ntest("it", () => {${body}});`;
    const { said } = await runEntry("entry.test.cjs", code, mode);
    expect(said).toEqual([
      "SAID ./dir/a.ts,./dir/b.ts object",
      mode === "an executable"
        ? 'SAID {"./dir/a.ts":"a","./dir/b.ts":"b"}'
        : `SAID TypeError: The "import.meta.glob" option "eager" needs import statements, so it can't be used in a CommonJS module`,
    ]);
  });

  test("only a direct call is expanded", async () => {
    const code = `
      const said = (ask: () => unknown) => { try { return Object.keys(ask() as object).join(); } catch (error: any) { return error.constructor.name; } };
      console.log("SAID", said(() => (import.meta as any).glob("./dir/a.ts")), said(() => import.meta.glob!<string>("./dir/b.ts")));
      const held = import.meta.glob;
      console.log("SAID", typeof held, said(() => (held as any)("./dir/a.ts")), said(() => (import.meta as any)["glob"]("./dir/a.ts")));`;
    const { said } = await runEntry("entry.test.ts", inTest(mode, code), mode);
    expect(said).toEqual([
      "SAID ./dir/a.ts ./dir/b.ts",
      mode === "an executable" ? "SAID undefined TypeError TypeError" : "SAID function TypeError TypeError",
    ]);
  });

  test("beside a macro", async () => {
    const files = { "proj/src/macro.ts": `export const made = () => "made at the build";` };
    const code = `console.log("SAID", made(), Object.keys(import.meta.glob("./dir/[ab].ts")).join());`;
    const head = `import { made } from "./macro.ts" with { type: "macro" };\n`;
    const { said } = await runEntry("entry.test.ts", head + inTest(mode, code), mode, files);
    expect(said).toEqual(["SAID made at the build ./dir/a.ts,./dir/b.ts"]);
  });

  test("a file that assigns its own function calls that", async () => {
    const code = `
      (import.meta as any).glob = (pattern: string) => ({ ["own " + pattern]: 1 });
      console.log("SAID", Object.keys(import.meta.glob("./dir/a.ts")).join());`;
    const { said } = await runEntry("entry.test.ts", inTest(mode, code), mode);
    expect(said).toEqual(["SAID own ./dir/a.ts"]);
  });
});
