import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

// `var __require = /* @__PURE__ */ createRequire(import.meta.url);` is what bundlers write at the head of the ES modules they emit.
// A `var` or a `let` that is stored to once and never seen before that is as good as a `const`: the names written for it are files of
// the program. BUN_JSC_crashIfInterpreterIsUsed=1 crashes the program if any of its files is interpreted.

const files = {
  "node_modules/optional-peer/package.json": `{ "name": "optional-peer", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/optional-peer/index.js": `exports.name = "the optional peer"; exports.inner = require("./inner.js");`,
  "node_modules/optional-peer/inner.js": `module.exports = "inner";`,
  "lib/local.cjs": `exports.name = "local";`,
  "lib/statement.cjs": `console.log("the statement runs"); exports.name = "statement";`,
  "lib/held.cjs": `exports.name = "held";`,
  "lib/pattern.cjs": `exports.taken = "taken";`,
  "lib/tested.cjs": `exports.name = "tested";`,
};

const compiled: Record<string, string> = {
  "as-bundlers-write-it.mjs": `import { createRequire } from "module";

//#region rolldown:runtime
var __require = /* @__PURE__ */ createRequire(import.meta.url);

//#endregion
let peer = null;
try {
	__require.resolve("optional-peer");
	peer = __require("optional-peer");
} catch {}
console.log(peer && peer.name, peer && peer.inner);
`,
  "in-a-let.mjs": `import { createRequire } from "node:module";
let made = createRequire(import.meta.url);
console.log(made("optional-peer").name, made("./lib/local.cjs").name);
`,
  "called-in-a-function.mjs": `import { createRequire } from "node:module";
var __require = createRequire(import.meta.url);
function load() { return __require("./lib/local.cjs").name; }
const later = () => __require("optional-peer").name;
console.log(load(), later());
`,
  "not-there.mjs": `import { createRequire } from "node:module";
var __require = createRequire(import.meta.url);
let peer = null;
try { peer = __require("not-installed"); } catch (error) { console.log(error.code); }
console.log(peer, __require("./lib/local.cjs").name);
`,
  // None of these looks at the object that the call answers, so the modules have none.
  "nobody-looks-at-the-object.mjs": `import { createRequire } from "node:module";
var made = createRequire(import.meta.url);
made("./lib/statement.cjs");
const held = made("./lib/held.cjs");
const { taken } = made("./lib/pattern.cjs");
console.log(made("./lib/tested.cjs") ? "yes" : "no", held.name, taken, made("./lib/local.cjs").name);
`,
  "import-meta-require.mjs": `var __require = import.meta.require;
function load() { return __require("./lib/local.cjs").name; }
console.log(load(), __require("./lib/held.cjs").name);
`,
  "called-above-its-statement.mjs": `import { createRequire } from "node:module";
try { made("./lib/statement.cjs"); } catch (error) { console.log(error.name); }
try { console.log(made("./lib/local.cjs").name); } catch (error) { console.log(error.name); }
var made = createRequire(import.meta.url);
made("./lib/statement.cjs");
console.log(made("./lib/local.cjs").name);
`,
};

// What is no constant stays an ordinary variable: the answers are plain Bun's, by whatever runs them.
const ordinary: Record<string, string> = {
  "called-before-it-is-made.mjs": `import { createRequire } from "node:module";
try { console.log(load()); } catch (error) { console.log(error.name); }
var made = createRequire(import.meta.url);
function load() { return made("./lib/local.cjs").name; }
console.log(load());
`,
  "declared-twice.mjs": `import { createRequire } from "node:module";
var made = createRequire(import.meta.url);
var made = name => "the second declaration got " + name;
console.log(made("./lib/local.cjs"));
`,
};

// A variable that is stored to again names no files of the program: what it loads is not compiled, and code that is not compiled is not loaded.
const refused: Record<string, string> = {
  "stored-to-again.mjs": `import { createRequire } from "node:module";
var made = createRequire(import.meta.url);
try { made("./lib/local.cjs"); } catch (error) { console.log(error.code, error.message.includes("it isn't in this executable")); }
made = name => "another function got " + name;
console.log(made("./lib/local.cjs"));
`,
};

describe.concurrent.each(Object.keys(refused))("%s", entry => {
  test("bun run --aot does not load the file", async () => {
    using dir = tempDir("create-require-in-a-var", { ...files, [entry]: refused[entry] });
    const { stdout, exitCode } = await runCommand([bunExe(), "run", "--debug-aot", entry], String(dir));
    expect({ stdout, exitCode }).toEqual({
      stdout: "MODULE_NOT_FOUND true\nanother function got ./lib/local.cjs\n",
      exitCode: 0,
    });
  });
});

describe.concurrent.each(Object.keys({ ...compiled, ...ordinary }))("%s", entry => {
  test("bun run --aot prints what bun run prints", async () => {
    using dir = tempDir("create-require-in-a-var", { ...files, [entry]: compiled[entry] ?? ordinary[entry] });
    const run = async (flags: string[], env: Record<string, string | undefined>) => {
      const { stdout, stderr, exitCode } = await runCommand([bunExe(), "run", ...flags, entry], String(dir), env);
      return { stdout, stderr, exitCode };
    };
    const plain = await run([], bunEnv);
    const aot = await run(
      ["--debug-aot"],
      entry in compiled ? { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" } : bunEnv,
    );
    expect(plain.exitCode).toBe(0);
    expect(aot.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: aot.stdout, exitCode: aot.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  });
});
