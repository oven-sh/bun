// docs/compiler/compatibility.mdx, "Loader hooks and the module cache": a compiled program asks Module._resolveFilename and Module.prototype.require
// only for a path that it computes, and the build points at a place that replaces one with TS100080.
//
// A line of the program that ends with `// stores <hook>` replaces that hook: plain Bun asks what the line stores. The build has to point at each of
// those lines and at no other. Where the line goes on with `, out of sight`, the build does not find the object that holds the hook, and has no
// message. __LINE__ stands for the file and the line that it is written on.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { compileCommand, withThreads } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./supported";

const written: Record<string, string> = {
  "main.cjs": `const { asked, wrap } = require("./wrap.cjs");
const Module = require("node:module");

// Written out.
Module._resolveFilename = wrap(Module._resolveFilename, __LINE__); // stores Module._resolveFilename
require("node:module").prototype.require = wrap(Module.prototype.require, __LINE__); // stores Module.prototype.require
Module[("_resolveFilename")] = wrap(Module._resolveFilename, __LINE__); // stores Module._resolveFilename

// Inside a pattern, and at the head of a loop.
[Module._resolveFilename] = [wrap(Module._resolveFilename, __LINE__)]; // stores Module._resolveFilename
({ hook: Module.prototype.require } = { hook: wrap(Module.prototype.require, __LINE__) }); // stores Module.prototype.require
({ hook: Module.prototype.require = wrap(Module.prototype.require, __LINE__) } = {}); // stores Module.prototype.require
for (Module._resolveFilename of [wrap(Module._resolveFilename, __LINE__)]); // stores Module._resolveFilename

// Behind the helper that tsc writes around the require() of a default import.
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
const node_module_1 = __importDefault(require("node:module"));
[node_module_1.default._resolveFilename] = [wrap(node_module_1.default._resolveFilename, __LINE__)]; // stores Module._resolveFilename

// The build does not find the object that holds the hook: one of two objects, as ./alias.cjs has it, an argument, a call that copies, a variable
// that is given the object later, a name that is put together.
require("./alias.cjs");
const either = globalThis.noOtherModule || Module;
either.prototype.require = wrap(either.prototype.require, __LINE__); // stores Module.prototype.require, out of sight
function install(Mod) {
  Mod._resolveFilename = wrap(Mod._resolveFilename, __LINE__); // stores Module._resolveFilename, out of sight
}
install(Module);
Object.assign(Module, { _resolveFilename: wrap(Module._resolveFilename, __LINE__) }); // stores Module._resolveFilename, out of sight
let later;
later = Module;
later.prototype.require = wrap(later.prototype.require, __LINE__); // stores Module.prototype.require, out of sight
Module[["_resolve", "Filename"].join("")] = wrap(Module._resolveFilename, __LINE__); // stores Module._resolveFilename, out of sight

// No store of a hook: an object of the program, a variable that held the hook, code that never runs.
const own = { name: "own" };
own._resolveFilename = wrap(Module._resolveFilename, __LINE__);
let held = Module._resolveFilename;
held = wrap(held, __LINE__);
if (false) [Module._resolveFilename] = [wrap(Module._resolveFilename, __LINE__)];
function nobodyCalls() {
  for (Module._resolveFilename of [wrap(Module._resolveFilename, __LINE__)]);
}

// One path that is written out, and one that is made as the program runs.
if (process.argv.length > 99) require("./lib/made.cjs");
asked.clear();
require("./lib/written.cjs");
const forWrittenPath = [...asked].sort();
asked.clear();
require("./lib/" + JSON.parse(process.env.NO_SUCH_VARIABLE_HERE ?? '"made"') + ".cjs");
console.log(JSON.stringify({ forWrittenPath, forMadePath: [...asked].sort() }), own.name, typeof held);
`,
  // Lines 3 to 8 of index.js in module-alias 2.2.3, as published, and the store of its line 30.
  "alias.cjs": `'use strict'
var wrap = require('./wrap.cjs').wrap

var BuiltinModule = require('module')

// Guard against poorly mocked module constructors
var Module = module.constructor.length > 1
  ? module.constructor
  : BuiltinModule

var oldResolveFilename = Module._resolveFilename
Module._resolveFilename = wrap(oldResolveFilename, __LINE__) // stores Module._resolveFilename, out of sight
`,
  // What the program stores as a hook. When the loader asks it, it notes the line that stored it and asks the hook before it.
  "wrap.cjs": `exports.asked = new Set();
exports.wrap = (original, line) =>
  function (request, ...rest) {
    exports.asked.add(line);
    return original.call(this, request, ...rest);
  };
`,
  "lib/written.cjs": `exports.mark = "written";\n`,
  "lib/made.cjs": `exports.mark = "made";\n`,
};

// Before the member that is stored to stands nothing, or the opening of a pattern or of a loop's head.
const opening = /^\s*(\[|\(\{ hook: |for \()?/;
const files: Record<string, string> = {};
const stores: { line: string; place: string; hook: string; inSight: boolean }[] = [];
for (const [name, text] of Object.entries(written)) {
  const lines = text.split("\n").map((line, index) => {
    const stored = /\/\/ stores (\S+?)(, out of sight)?$/.exec(line);
    if (stored) {
      const place = `${name}:${index + 1}:${opening.exec(line)![0].length + 1}`;
      stores.push({ line: `${name}:${index + 1}`, place, hook: stored[1], inSight: !stored[2] });
    }
    return line.replaceAll("__LINE__", JSON.stringify(`${name}:${index + 1}`));
  });
  files[name] = lines.join("\n");
}
const everyStore = stores.map(store => store.line).sort();
const rest = " own function\n";

test("TS100080 stands at each store of a loader hook on an object that the build finds", async () => {
  using dir = tempDir("aot-replaced-loader-hook", files);
  const cwd = String(dir);
  const executable = join(cwd, "main");
  const env = { ...bunEnv, NO_COLOR: "1" };

  // Under plain Bun each marked line is a store: a require() asks what it stored, whatever the path.
  const plain = await run([bunExe(), "main.cjs"], cwd, env);
  expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({
    stdout: JSON.stringify({ forWrittenPath: everyStore, forMadePath: everyStore }) + rest,
    exitCode: 0,
  });

  // One thread of the engine: on more, a Bun with assertions crashes in about half of its builds (oven-sh/bun#48169). The message is the front end's.
  const command = [bunExe(), ...compileCommand, withThreads(1), "./main.cjs", "--outfile", executable];
  const built = await run(command, cwd, env);
  const said = built.stdout + built.stderr;
  const message = /TS100080: A compiled program calls (\S+) only [^\n]*\n\s+at \S*?([^\s\\/]+:\d+:\d+)/g;
  expect({
    pointedAt: Array.from(said.matchAll(message), ([, hook, place]) => `${place} ${hook}`).sort(),
    exitCode: built.exitCode,
  }).toEqual({
    pointedAt: stores
      .filter(store => store.inSight)
      .map(store => `${store.place} ${store.hook}`)
      .sort(),
    exitCode: 0,
  });

  // The executable of this program asks none of them for the path that is written out, and each of them for the path that it makes.
  const compiled = await run([executable], cwd, env);
  expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({
    stdout: JSON.stringify({ forWrittenPath: [], forMadePath: everyStore }) + rest,
    exitCode: 0,
  });
});
