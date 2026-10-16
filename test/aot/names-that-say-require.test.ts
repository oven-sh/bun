import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Bundlers and libraries keep `require` under names of their own: `__require`, `nodeRequire`, `require$1`. Where such a name is called
// with a name written out, the file, or the built-in module, is compiled with the program, so that whoever loads it at run time gets
// compiled code. The call itself is an ordinary call. BUN_JSC_crashIfInterpreterIsUsed=1 crashes the program if anything is interpreted.

const files = {
  "node_modules/optional-peer/package.json": `{ "name": "optional-peer", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/optional-peer/index.js": `exports.name = "the optional peer"; exports.inner = require("./inner.js");`,
  "node_modules/optional-peer/inner.js": `module.exports = "inner";`,
  "lib/local.cjs": `exports.name = "local";`,
  "lib/asks-its-parent.cjs": `exports.kind = typeof module.parent.require("node:zlib").gzipSync;`,
  "chunks/runtime.mjs": `import { createRequire } from "node:module";
var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();
export { __require };
`,
};

const programs: Record<string, string> = {
  "made-by-a-function-called-at-once.mjs": `import { createRequire } from "node:module";
var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();
function plugin() { const peer = __require("optional-peer"); return peer.name + " " + peer.inner; }
console.log(plugin());
`,
  "imported-from-another-chunk.mjs": `import { __require } from "./chunks/runtime.mjs";
console.log(__require("optional-peer").name);
`,
  "a-built-in-module-nothing-else-imports.mjs": `import { createRequire } from "node:module";
var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();
console.log(typeof __require("node:zlib").gzipSync, typeof __require("querystring").parse);
`,
  "taken-off-the-module.cjs": `const nodeRequire = module && module.require;
console.log(typeof nodeRequire.call(module, "node:zlib").gzipSync, typeof module.require("querystring").parse);
`,
  "handed-on.cjs": `const own = module;
console.log(typeof own.require("node:zlib").gzipSync);
`,
  "a-computed-name-through-the-module.cjs": `const load = module.require;
console.log(typeof load.call(module, ["node:", "zlib"].join("")).gzipSync);
`,
  "a-loader-that-takes-stubs.cjs": `const proxyquire = (name, stubs) => Object.assign({}, require(require.resolve(name)), stubs);
console.log(JSON.stringify(proxyquire("./lib/local.cjs", { stubbed: true })));
`,
  "a-loader-that-takes-stubs-and-evicts.cjs": `function proxyquire(name, stubs) {
  const path = require.resolve(name);
  delete require.cache[path];
  return Object.assign(require(path), stubs);
}
const first = proxyquire("optional-peer", { turn: 1 }), second = proxyquire("optional-peer", { turn: 2 });
console.log(first === second, first.name, first.turn, second.turn);
`,
  "through-the-parent.cjs": `console.log(require("./lib/asks-its-parent.cjs").kind);
`,
  "kept-under-another-name.cjs": `const nodeRequire = require;
const require$1 = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;
console.log(nodeRequire("./lib/local.cjs").name, require$1("optional-peer").name);
`,
  "names-that-are-nothing.cjs": `const requireNothing = text => "got " + text;
const acquire = text => "acquired " + text;
console.log(requireNothing("just a string"), requireNothing("./lib/local.cjs"), acquire("./lib/local.cjs"), requireNothing("not-installed"));
`,
};

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  test("bun run --aot interprets nothing and prints what bun run prints", async () => {
    using dir = tempDir("names-that-say-require", { ...files, [entry]: programs[entry] });
    const run = async (flags: string[], env: Record<string, string | undefined>) => {
      await using proc = Bun.spawn({ cmd: [bunExe(), "run", ...flags, entry], cwd: String(dir), env, stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      return { stdout, stderr, exitCode };
    };
    const plain = await run([], bunEnv);
    const aot = await run(["--aot"], { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" });
    expect(plain.exitCode).toBe(0);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
