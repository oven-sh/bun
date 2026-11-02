// A plugin that answers `external: true` leaves a file out of the build, like the `external` option. The executable loads the file at
// run time, and the file may use any part of Bun, also parts that the compiled program never names: build-both-ways.ts.
import { isWindows, tempDir } from "harness";
import { join, resolve } from "path";
import { buildBothWays, type Case } from "./build-both-ways";

const makeExternal = `build.onResolve({ filter: /outside/ }, () => ({ path: join(folder, "outside.cjs"), external: true }));`;
const main = `const { readFileSync } = require("node:fs"); console.log(typeof readFileSync, require("./outside.cjs"));`;

const cases: Record<string, Case> = {
  "it calls library functions that the program does not name": {
    files: {
      "main.cjs": main,
      "outside.cjs": `const refused = Reflect.ownKeys(console).filter(key => { try { console[key]; return false; } catch { return true; } });
module.exports = [new console.Console(process.stdout).log.name, refused.join(), require("node:fs").statSync(".").isDirectory(), require("node:path").join("a", "b")].join(" | ");`,
    },
    plugins: [makeExternal],
    options: `entrypoints: ["./main.cjs"]`,
    interprets: true,
    prints: `function log |  | true | ${join("a", "b")}\n`,
  },
};

const compiler = process.env.CC || Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");
if (compiler && !isWindows) {
  const addon = join(String(tempDir("aot-external-code-addon", {})), "addon.node");
  const flags = process.platform === "darwin" ? ["-undefined", "dynamic_lookup"] : [];
  const headers = resolve(import.meta.dir, "../../src/runtime/napi");
  const built = Bun.spawnSync([
    compiler,
    "-shared",
    "-fPIC",
    ...flags,
    "-I" + headers,
    join(import.meta.dir, "napi-addon", "addon.c"),
    "-o",
    addon,
  ]);
  if (built.exitCode !== 0) throw new Error("the addon does not compile: " + built.stderr);
  cases["it requires a native addon"] = {
    files: { "main.cjs": main, "outside.cjs": `module.exports = Object.keys(require(process.env.ADDON)).length > 0;` },
    plugins: [makeExternal],
    options: `entrypoints: ["./main.cjs"]`,
    interprets: true,
    env: { ADDON: addon },
    prints: "function true\n",
  };
}

buildBothWays("compile/aot/code that a plugin makes external", cases);
