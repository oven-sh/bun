import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

const here = process.platform;
const elsewhere = here === "darwin" ? "linux" : "darwin";
const addon = `"../prebuilds/addon.node"`;
const choice = addon;
const head = `const path = require("node:path");\n`;
const guard = (platform: string) =>
  `if (process.platform !== "${platform}") {\n  throw new Error("only available on another platform");\n}\n`;

const unreachable: Record<string, string> = {
  "a-choice-behind-a-throw": `${head}${guard(elsewhere)}module.exports = require(${choice}).thing;\n`,
  "a-path-from-the-own-folder-behind-a-throw": `${head}${guard(elsewhere)}module.exports = require(path.resolve(__dirname, ${addon})).thing;\n`,
  "a-string-behind-a-throw": `${head}${guard(elsewhere)}module.exports = require(${addon}).thing;\n`,
  "a-choice-behind-a-return": `${head}if (process.platform !== "${elsewhere}") {\n  console.log("only available on another platform");\n  return;\n}\nmodule.exports = require(${choice}).thing;\n`,
  "a-choice-behind-a-throw-in-a-function": `${head}exports.load = function () {\n${guard(elsewhere)}  return require(${choice}).thing;\n};\nexports.load();\n`,
  "a-choice-behind-a-throw-in-an-else": `${head}if (process.platform === "${elsewhere}") {\n  exports.ready = true;\n} else {\n  throw new Error("only available on another platform");\n}\nmodule.exports = require(${choice}).thing;\n`,
  "a-function-expression-behind-a-throw": `${head}${guard(elsewhere)}exports.load = function () {\n  return require(${choice}).thing;\n};\n`,
  "resolved-and-imported-behind-a-throw": `${head}${guard(elsewhere)}console.log(require.resolve(${addon}));\nimport(${addon});\n`,
  "a-choice-in-a-branch-that-is-never-taken": `${head}if (process.platform === "${elsewhere}") {\n  module.exports = require(${choice}).thing;\n} else {\n  throw new Error("only available on another platform");\n}\n`,
};

const reachable: Record<string, string> = {
  "a-guard-that-lets-this-platform-pass": `${head}${guard(here)}module.exports = require(${choice}).thing;\n`,
  "a-guard-that-is-decided-when-the-program-runs": `${head}if (process.env.THE_ADDON_IS_OFF) {\n  throw new Error("off");\n}\nmodule.exports = require(${choice}).thing;\n`,
  "a-function-declared-behind-a-throw": `${head}try {\n  load();\n} catch (error) {\n  console.log("load:", error.code);\n}\n${guard(elsewhere)}function load() {\n  return require(${choice}).thing;\n}\n`,
  "a-throw-in-another-case": `${head}switch (process.argv.length) {\n  case 100:\n    throw new Error("a hundred arguments");\n  default:\n    module.exports = require(${choice}).thing;\n}\n`,
  "a-throw-that-is-caught": `${head}try {\n  throw new Error("caught");\n} catch {\n  module.exports = require(${choice}).thing;\n}\n`,
};

const packages = { ...unreachable, ...reachable };
const markOf = (name: string) => `the-mark-of-the-addon-of-${name};`;

const files: Record<string, string> = {
  "main.js": Object.keys(packages)
    .map(
      name =>
        `try {\n  console.log("${name}:", typeof require("${name}"));\n} catch (error) {\n  console.log("${name}:", error.code ?? error.message);\n}\n`,
    )
    .join(""),
};
for (const [name, index] of Object.entries(packages)) {
  files[`node_modules/${name}/package.json`] = JSON.stringify({ name, version: "1.0.0", main: "js/index.js" });
  files[`node_modules/${name}/js/index.js`] = index;
  files[`node_modules/${name}/prebuilds/addon.node`] = markOf(name).repeat(100);
}

const env = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

// TODO: an addon that is named only behind a throw or a return is embedded.
test.todo(
  "an addon is embedded in an executable only if it is named where the program may come on its target",
  async () => {
    using dir = tempDir("files-referenced-in-unreachable-code", files);
    const plain = await run([bunExe(), "run", "main.js"], String(dir), bunEnv);
    expect(plain.exitCode).toBe(0);

    const build = await run(
      [bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", "program"],
      String(dir),
      bunEnv,
    );
    expect({ stderr: build.stderr, exitCode: build.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
    const executable = Buffer.from(await Bun.file(join(String(dir), isWindows ? "program.exe" : "program")).bytes());
    expect(Object.keys(packages).filter(name => executable.includes(markOf(name)))).toEqual(Object.keys(reachable));

    const compiled = await run([join(String(dir), "program")], String(dir), env);
    expect(compiled.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  },
  240_000,
);

test("bun run --aot prints what bun run prints", async () => {
  using dir = tempDir("files-referenced-in-unreachable-code", files);
  const plain = await run([bunExe(), "run", "main.js"], String(dir), bunEnv);
  const inPlace = await run([bunExe(), "run", "--debug-aot", "main.js"], String(dir), env);
  expect(inPlace.stderr).not.toContain("crashIfInterpreterIsUsed");
  expect({ stdout: inPlace.stdout, exitCode: inPlace.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}, 240_000);
