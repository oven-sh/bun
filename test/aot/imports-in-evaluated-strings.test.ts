import { describe, expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { slot, unsupported } from "./harness/commands";
import { test } from "./harness/default-timeout";
import { run } from "./harness/run";

// The build finds the module that such a string names, however it is spaced.
const loads = [
  `new Function("return import('./dep.mjs')")()`,
  `new Function("return\\timport('./dep.mjs')")()`,
  `new Function("return  import('./dep.mjs')")()`,
  `new Function("\\n  return import ( './dep.mjs' ) ;\\n")()`,
  `new Function("return import(/* webpackIgnore: true */ './dep.mjs')")()`,
  `new Function("return /* c */ import('./dep.mjs')")()`,
  `Function("return\\timport('./dep.mjs')")()`,
  `eval("\\timport('./dep.mjs')")`,
  `(0, eval)("import('./dep.mjs')")`,
  `new Function("path", "return\\timport(path)")("./dep.mjs")`,
  `new Function("path", "return import(/* @vite-ignore */ path)")("./dep.mjs")`,
];
const files = Object.fromEntries(
  loads.map((load, i) => [`load${i}.cjs`, `exports.load = () => ${load.replaceAll("dep.mjs", `dep${i}.mjs`)};\n`]),
);
const modules = Object.fromEntries(loads.map((_, i) => [`dep${i}.mjs`, `export const value = ${i};\n`]));
const program = `(async () => {
${loads.map((_, i) => `  await require("./load${i}.cjs").load().then(module => console.log(${i}, module.value), error => console.log(${i}, error.message));`).join("\n")}
})();
`;

describe.skipIf(unsupported)("import() in a string", () => {
  test("loads what the build has compiled", async () => {
    await slot(async () => {
      using dir = tempDir("imports-in-evaluated-strings", { "main.cjs": program, ...files, ...modules });
      using away = tempDir("imports-in-evaluated-strings-away", {});
      const executable = join(String(away), "main");
      const built = await run(
        [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", executable],
        String(dir),
      );
      expect(built.exitCode, built.stderr).toBe(0);
      const { stdout, stderr } = await run([executable], String(away));
      expect({ stdout, stderr }).toEqual({ stdout: loads.map((_, i) => `${i} ${i}\n`).join(""), stderr: "" });
    });
  });
});
