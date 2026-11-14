import { describe, expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { slot, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { run } from "./harness/run";

// The build compiles these strings. An executable that is started with the flag refuses them, as bun run does.
const evaluations: [name: string, code: string][] = [
  ["direct eval of an arrow function", `eval("(() => 2)")()`],
  ["direct eval of a call", `(() => { const b = { c: x => x + 1 }; return eval("b.c(4)"); })()`],
  ["direct eval of an assignment", `(() => { const b = {}; eval("b.f = function () { return 5 }"); return b.f(); })()`],
  ["direct eval of a name", `(() => { "use strict"; return eval("named"); })()`],
  ["indirect eval of a function", `(0, eval)("(function () { return 1 })")()`],
  ["indirect eval of statements", `(() => { (0, eval)("globalThis.q = 6"); return globalThis.q; })()`],
  ["Function", `Function("a", "return a + 2")(2)`],
  ["new Function", `new Function("a", "return a + 1")(2)`],
  [
    "new Function in a loop",
    `(() => { let s = 0; for (const k of ["a", "b"]) s += new Function("o", "return o." + k)({ a: 1, b: 2 }); return s; })()`,
  ],
  ["a function that imports", `(() => { const load = new Function("s", "return import(s)"); return load.length; })()`],
  ["a function that imports, unused", `(() => { new Function("s", "return import(s)"); return 7; })()`],
  ["the type of a function that imports", `typeof new Function("s", "return import(s)")`],
  ["eval of an import", `typeof eval("import('node:path')").then`],
  ["indirect eval of an import", `typeof (0, eval)("import('node:path')").then`],
];
const program = `const named = 21;
function attempt(name, make) {
  try {
    console.log(name + ":", make());
  } catch (error) {
    console.log(name + ":", String(error), error.line, error.column, error.stack.includes("at eval") || error.stack.includes("at Function"));
  }
}
${evaluations.map(([name, code]) => `attempt(${JSON.stringify(name)}, () => ${code});`).join("\n")}
`;
const flag = "--disallow-code-generation-from-strings";
const refused = "EvalError: Code generation from strings disallowed for this context";

describe.skipIf(unsupported)("strings that the build has compiled", () => {
  test.each(["main.cjs", "main.mjs"])("%s", async name => {
    await slot(async () => {
      using dir = tempDir("known-evaluations-check-level", { [name]: program });
      const executable = join(String(dir), "main");
      const built = await run([bunExe(), "build", "--compile", "--aot", name, "--outfile", executable], String(dir));
      expect(built.exitCode, built.stderr).toBe(0);
      const free = await run([executable], String(dir));
      const plain = await run([bunExe(), "--no-install", name], String(dir));
      expect(free.stdout).toBe(plain.stdout);
      for (const level of [flag, flag + "=strict"]) {
        const env = { ...bunEnv, BUN_OPTIONS: level };
        const { stdout } = await run([executable], String(dir), env);
        expect(stdout).toBe((await run([bunExe(), "--no-install", name], String(dir), env)).stdout);
        const said = stdout
          .trim()
          .split("\n")
          .map(line => line.replace(/ \d+ \d+ true$/, ""));
        expect(said).toEqual(evaluations.map(([name]) => `${name}: ${refused}`));
      }
    });
  });
});
