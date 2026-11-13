import { describe, expect, test } from "bun:test";
import { bunExe, tempDir } from "harness";
import { run } from "./harness/run";

// The parser of a compiled program splits a list of expressions of JavaScript into statements. A list that lacks an operand is a syntax error.
const head = `let a = x => 1, b = x => 2, x = 0;\nconsole.log("never printed");\n`;
const lists = [
  "a(), ;",
  "a(), b(), ;",
  "a(,);",
  "a(), , b;",
  "a(), , b();",
  "(a(),);",
  "for (; a(), ;) {}",
  "a(), 1 + ;",
  "a(), !;",
  "a(), -, b();",
  "a, ;",
  "a(), a() ? : 2;",
  "a(), a() ? 1 : ;",
  "a(), x = ;",
  "a(), delete ;",
  "a(), `${}`;",
  "a(), () => ;",
  "a(), () => { b(), ; };",
  "() => { a(), ; };",
  "`${() => { a(), ; }}`;",
  "function f() { a(), ; }",
  "class C { m() { a(), ; } }",
  "class C { static { a(), ; } }",
  "if (a()) b(), ; else b();",
  "switch (a()) { case 1: b(), ; }",
];

async function runIn(cwd: string, ...args: string[]) {
  const { stdout, stderr, exitCode } = await run([bunExe(), ...args], cwd);
  return { said: stdout + stderr, exitCode };
}

const filesOf = (extension: string) =>
  Object.fromEntries(lists.map((list, i) => [`list${i}.${extension}`, `${head}${list}\n`]));

// The errors that name the line of a list.
const listsIn = (said: string, extension: string) =>
  lists.filter((_, i) => new RegExp(`\\blist${i}\\.${extension}[:(]3[:,]\\d+`).test(said));

describe.concurrent("a list of expressions that lacks an operand is an error", () => {
  test.each(["js", "cjs", "mjs", "ts"])("of a build of %s", async extension => {
    const requests = lists.map((_, i) => `import("./list${i}.${extension}");\n`).join("");
    using dir = tempDir("aot-missing-operands", { "main.js": requests, ...filesOf(extension) });
    const args = ["build", "--compile", "--aot", "./main.js", "--outfile", "app"];
    const { said, exitCode } = await runIn(String(dir), ...args);
    expect({ named: listsIn(said, extension), exitCode }).toEqual({ named: lists, exitCode: 1 });
  });

  test("of a run that compiles", async () => {
    using dir = tempDir("aot-missing-operands", filesOf("js"));
    const { said, exitCode } = await runIn(String(dir), "run", "--debug-aot", "./list0.js");
    expect({ named: listsIn(said, "js"), exitCode }).toEqual({ named: [lists[0]], exitCode: 1 });
    expect(said).not.toContain("never printed\n");
  });

  test("of bun check", async () => {
    const compilerOptions = { allowJs: true, checkJs: true, noEmit: true, moduleDetection: "force" };
    using dir = tempDir("aot-missing-operands", {
      "tsconfig.json": JSON.stringify({ compilerOptions, include: ["*"] }),
      ...filesOf("js"),
    });
    const { said, exitCode } = await runIn(String(dir), "check");
    expect({ named: listsIn(said, "js"), exitCode }).toEqual({ named: lists, exitCode: 1 });
  });
});
