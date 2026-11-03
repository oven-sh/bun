// pirates, @babel/register and ts-node store a handler into Module._extensions, and decache walks the children of a module object and takes each out of require.cache:
// packages all of them. Over layers only the program that holds the package knew of it, and the test failed on a file of the project:
// "Cannot replace a loader in Module._extensions: imports in this executable were resolved at build time", "Cannot take '../src/leaf.js' out of require.cache".
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { test } from "./supported";

const tools = `
  const Module = require("module");
  const short = file => require("path").basename(String(file));
  const seen = [];
  exports.seen = seen;
  exports.handler = ext => {
    const original = Module._extensions[ext];
    Module._extensions[ext] = function (module, filename) { seen.push("handler " + short(filename)); return original(module, filename); };
  };
  exports.transform = ext => {
    const original = Module._extensions[ext];
    Module._extensions[ext] = function (module, filename) {
      const compile = module._compile;
      module._compile = function (code, name) { seen.push("compile " + short(name)); return compile.call(this, code.replace(/"plain"/g, '"changed"'), name); };
      return original(module, filename);
    };
  };
  exports.note = () => { Module._extensions[".note"] = function (module, filename) { seen.push("note " + short(filename)); module.exports = require("fs").readFileSync(filename, "utf8").trim(); }; };
  exports.decache = file => {
    const visited = {};
    (function run(current) {
      visited[current.id] = true;
      current.children.forEach(child => { if (!visited[child.id]) run(child); });
      seen.push("out " + short(current.filename));
      delete require.cache[current.id];
    })(require.cache[file]);
  };`;
const ways = {
  "a handler": [`tools.handler(".js");`, `plain,plain | handler b.js`],
  "a handler that changes the text": [`tools.transform(".js");`, `plain,changed | compile b.js`],
  "a handler for a new extension": [`tools.note();`, `plain,plain,a note | note x.note`, `, user.note()`],
  "a walk over the children": [
    `user.b(); tools.decache(require.resolve("./src/user.js")); user = require("./src/user.js");`,
    `plain,plain | out a.js,out b.js,out user.js`,
  ],
};

async function linesOf([install, , more = ""]: string[], flags: string[], words?: string) {
  using dir = tempDir("aot-package-stores-a-handler", {
    "package.json": `{ "name": "p" }`,
    "node_modules/tools/package.json": `{ "name": "tools", "main": "index.js" }`,
    "node_modules/tools/index.js": tools,
    "src/a.js": `exports.kind = "plain";\n`,
    "src/b.js": `exports.kind = "plain";\n`,
    "src/x.note": `a note\n`,
    "src/user.js": `exports.a = () => require("./a.js").kind;\nexports.b = () => require("./b.js").kind;\nexports.note = () => require("./x.note");\n`,
    "a.test.cjs": `
      const { test } = require("bun:test");
      const tools = require("tools");
      let user = require("./src/user.js");
      test("t", () => {
        user.a();
        ${install}
        console.error("OUT", [user.a(), user.b()${more}].join(), "|", tools.seen.join());
      });`,
  });
  const env = words ? { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: words } : bunEnv;
  await using run = Bun.spawn({
    cmd: [bunExe(), "test", ...flags, "--isolate"],
    cwd: String(dir),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const [stderr, exitCode] = await Promise.all([run.stderr.text(), run.exited]);
  return { lines: stderr.split("\n").filter(line => /^(OUT|error)/.test(line)), exitCode };
}

test.concurrent.each(Object.entries(ways))(
  "%s",
  async (_, way) => {
    const plain = await linesOf(way, []);
    expect(plain).toEqual({ lines: ["OUT " + way[1]], exitCode: 0 });
    expect(await linesOf(way, ["--aot"])).toEqual(plain);
    expect(await linesOf(way, ["--aot"], "TestRunLayers:2")).toEqual(plain);
    expect(await linesOf(way, ["--aot"], "TestRunLayers:3")).toEqual(plain);
  },
  240_000,
);
