import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { test } from "./harness/default-timeout";
import { run } from "./harness/run";

const programs = {
  "tested.cjs": `console.log([1, "a", x => x].map(v => v instanceof Function).join(), typeof Function, typeof eval);`,
  "compared.cjs": `const f = x => x; console.log(f.constructor === Function, Object.getPrototypeOf(f) === Function.prototype);`,
  "extended.cjs": `Function.prototype.twice = function (x) { return this(this(x)); }; console.log((x => x + 3).twice(1));`,
  "replaced.cjs": `globalThis.eval = 5; console.log(globalThis.eval);`,
  "held.mjs": `const e = eval; globalThis.eval = 5; console.log(typeof e, typeof eval); export {};`,
  "called.cjs": `const text = "1 + " + process.argv.length; console.log(eval(text) > 1, new Function("a", "return a + 1")(2));`,
};

for (const name of Object.keys(programs)) {
  test(`--aot-allow-code-from-disk: ${name}`, async () => {
    using directory = tempDir("asks-about-evaluators", programs);
    const cwd = String(directory);
    const executable = join(cwd, "program");
    const plain = await run([bunExe(), join(cwd, name)], cwd, bunEnv);
    const build = await run(
      [bunExe(), "build", "--compile", "--aot", "--aot-allow-code-from-disk", `./${name}`, "--outfile", executable],
      cwd,
      bunEnv,
    );
    expect({ errors: build.stderr.match(/^error.*/gm), exitCode: build.exitCode }).toEqual({
      errors: null,
      exitCode: 0,
    });
    expect(await run([executable], cwd, bunEnv)).toEqual(plain);
    expect(plain.exitCode).toBe(0);
  });
}
