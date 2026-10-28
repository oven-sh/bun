import { expect } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// `Module._findPath(request, paths)` looks the request up in each directory of `paths` and nowhere else. The executable reads
// nothing from the disk: it has its packages in a table, by the `node_modules` directory that holds them. A package is found
// there as `require()` finds it, by its `exports`, and a path that the `exports` do not list is not found.

const files = {
  "app/main.cjs": `const Module = require("node:module");
const path = require("node:path");
const nodeModules = path.join(__dirname, "node_modules");
const driver = path.join(nodeModules, "driver");
const found = (request, paths) => {
  const file = Module._findPath(request, paths);
  return typeof file === "string" ? file.split("node_modules").pop().replaceAll("\\\\", "/") : file;
};
console.log(JSON.stringify({
  "a package with a main": found("driver", [nodeModules]),
  "a file of a package": found("driver/lib/extra", [nodeModules]),
  "a scoped package with exports": found("@scope/driver", [nodeModules]),
  "the require condition": found("both", [nodeModules]),
  "a name that exports list": found("closed/feature", [nodeModules]),
  "a path that exports do not list": found("closed/lib/feature.js", [nodeModules]),
  "a package without a main export": found("closed", [nodeModules]),
  "a package that is no entry point": found("left-out", [nodeModules]),
  "a package of the node_modules directory above": found("driver", [path.join(nodeModules, "orm", "node_modules")]),
  "the lookup paths": found("@scope/driver", Module._resolveLookupPaths("@scope/driver", module)),
  "the directory of the package, then node_modules": found("driver", [driver, nodeModules]),
  "./ and a file, in the directory of the package": found("./lib/entry.js", [driver]),
  "an absolute request": found(path.join(driver, "lib", "entry.js")),
}, null, 1));
`,
  "app/node_modules/orm/package.json": `{ "name": "orm", "main": "lib/index.js" }`,
  "app/node_modules/orm/lib/index.js": `exports.name = "orm";\n`,
  "app/node_modules/driver/package.json": `{ "name": "driver", "main": "./lib/entry.js" }`,
  "app/node_modules/driver/lib/entry.js": `exports.name = "driver";\n`,
  "app/node_modules/driver/lib/extra.js": `exports.name = "extra";\n`,
  "app/node_modules/@scope/driver/package.json": `{ "name": "@scope/driver", "exports": { ".": "./main.cjs" } }`,
  "app/node_modules/@scope/driver/main.cjs": `exports.name = "scoped";\n`,
  "app/node_modules/both/package.json": `{ "name": "both", "exports": { ".": { "import": "./es.mjs", "require": "./common.cjs" } } }`,
  "app/node_modules/both/es.mjs": `export default "imported";\n`,
  "app/node_modules/both/common.cjs": `exports.name = "required";\n`,
  "app/node_modules/closed/package.json": `{ "name": "closed", "exports": { "./feature": "./lib/feature.js" } }`,
  "app/node_modules/closed/lib/feature.js": `exports.name = "feature";\n`,
  "app/node_modules/left-out/index.js": `exports.name = "left out";\n`,
};

test(
  "Module._findPath finds the packages of the program in their node_modules directory",
  async () => {
    using dir = tempDir("find-path-in-program", files);
    const app = join(String(dir), "app");
    const build = await run(
      [
        bunExe(),
        "build",
        "--compile",
        "--aot",
        "main.cjs",
        "node_modules/orm/lib/*.js",
        "node_modules/driver/lib/*.js",
        "node_modules/@scope/driver/main.cjs",
        "node_modules/both/*.{mjs,cjs}",
        "node_modules/closed/lib/*.js",
        "--outfile",
        "../program",
      ],
      app,
      bunEnv,
    );
    expect({ stderr: build.exitCode === 0 ? "" : build.stderr, exitCode: build.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    // Not where it was built: nothing is found on the disk.
    mkdirSync(join(String(dir), "elsewhere"));
    const alone = await run([join(String(dir), "program")], join(String(dir), "elsewhere"), bunEnv);
    expect({ found: alone.stdout && JSON.parse(alone.stdout), exitCode: alone.exitCode }).toEqual({
      found: {
        "a package with a main": "/driver/lib/entry.js",
        "a file of a package": "/driver/lib/extra.js",
        "a scoped package with exports": "/@scope/driver/main.cjs",
        "the require condition": "/both/common.cjs",
        "a name that exports list": "/closed/lib/feature.js",
        "a path that exports do not list": false,
        "a package without a main export": false,
        "a package that is no entry point": false,
        "a package of the node_modules directory above": false,
        "the lookup paths": "/@scope/driver/main.cjs",
        "the directory of the package, then node_modules": "/driver/lib/entry.js",
        "./ and a file, in the directory of the package": "/driver/lib/entry.js",
        "an absolute request": "/driver/lib/entry.js",
      },
      exitCode: 0,
    });
  },
  // A debug build of bun is 1.6 GB, and the build copies it.
  isDebug ? 300_000 : 120_000,
);
