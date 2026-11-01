import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// An ORM loads its driver by `require(name)` in a method, and every call spells the name: sequelize in a method of a base class that the
// heirs call on `this`, typeorm in a static method that other files call through the class they have required. The files so named
// belong to the program. A name that leads nowhere fails when it is asked for, as it does in a plain run: both try several drivers.
// A package may name one file for `require` and another for `import`: the load says which of the two it means.
const driver = (name: string) => ({
  [`node_modules/${name}/package.json`]: `{ "name": "${name}", "version": "1.0.0", "main": "index.js" }`,
  [`node_modules/${name}/index.js`]: `exports.which = "${name}";`,
});
const files: Record<string, string> = {
  "package.json": `{ "name": "drivers" }`,
  ...driver("for-this"),
  ...driver("for-static"),
  "node_modules/two-doors/package.json": `{ "name": "two-doors", "version": "1.0.0", "exports": { ".": { "import": "./door.mjs", "require": "./door.cjs" } } }`,
  "node_modules/two-doors/door.mjs": `export const which = "imported";`,
  "node_modules/two-doors/door.cjs": `exports.which = "required";`,
  "node_modules/by-this/package.json": `{ "name": "by-this", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/by-this/index.js": `class Manager {
      _load(name) { try { return require(name); } catch (error) { throw new Error("Please install " + name + " package manually"); } }
    }
    class Special extends Manager { constructor() { super(); this.lib = this._load("for-this"); } }
    class Absent extends Manager { constructor() { super(); this.lib = this._load("never-installed"); } }
    class Doors extends Manager { constructor() { super(); this.lib = this._load("two-doors"); } }
    exports.connect = () => new Special().lib.which;
    exports.doors = () => new Doors().lib.which;
    exports.absent = () => { try { return new Absent().lib.which; } catch (error) { return error.message; } };`,
  "node_modules/by-static/package.json": `{ "name": "by-static", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/by-static/tools.js": `"use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
    exports.Tools = void 0;
    class Tools {
      static load(name) { return require(name); }
      static async bring(name) { return await import(name); }
    }
    exports.Tools = Tools;`,
  "node_modules/by-static/index.js": `"use strict";
    const tools_1 = require("./tools");
    exports.connect = options => (options.driver ?? tools_1.Tools.load("for-static")).which;
    exports.doors = async () => (await tools_1.Tools.bring("two-doors")).which;`,
  "main.mjs": `import byThis from "by-this";
    import byStatic from "by-static";
    console.log(byThis.connect(), byThis.doors(), byThis.absent());
    console.log(byStatic.connect({}), await byStatic.doors());`,
};

test("a driver that a method loads by a name which its callers spell is in the executable", async () => {
  using dir = tempDir("aot-driver-by-name", files);
  using elsewhere = tempDir("aot-driver-by-name-elsewhere", {});
  const directory = String(dir);
  const plain = await run([bunExe(), "main.mjs"], directory, bunEnv);
  expect(plain.stdout).toBe("for-this required Please install never-installed package manually\nfor-static imported\n");
  const executable = join(directory, "drivers");
  const flags = ["main.mjs", "--outfile", executable];
  const built = await run([bunExe(), "build", "--compile", "--aot", ...flags], directory, bunEnv);
  expect(built.exitCode).toBe(0);
  const compiled = await run([executable], String(elsewhere), bunEnv);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
}, 120_000);
