import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { raiseDefaultTimeout } from "./harness/default-timeout";
import { run } from "./harness/run";
import { test } from "./supported";

raiseDefaultTimeout(120_000);

// The CommonJS loader that NAPI-RS 3 writes for an addon begins `require = createRequire(__filename)` and pushes every error of a `require()` below onto a list: the package then
// says "Cannot find native binding". What the call makes resolves as the file's own `require` does.
const head = `const { createRequire } = require("node:module");\nrequire = createRequire(__filename);`;
const shared = {
  "other.cjs": `exports.other = "the other file";`,
  "sub/other.cjs": `exports.other = "the file of the folder below";`,
  "node_modules/dep/package.json": `{ "name": "dep", "version": "1.0.0", "main": "index.js" }`,
  "node_modules/dep/index.js": `module.exports = { dep: "the package" };`,
};

const asPlain: Record<string, string> = {
  "a file, a package and a built-in module": `${head}\nconsole.log(require("./other.cjs").other, require("dep").dep, typeof require("node:fs").readFileSync);`,
  "as NAPI-RS writes it": `${head}
let binding = null;
const errors = [];
function load() {
  try { return require("./missing.linux-x64-gnu.node"); } catch (error) { errors.push(error); }
  try { return require("dep"); } catch (error) { errors.push(error); }
}
binding = load();
if (!binding) throw new Error("Cannot find native binding", { cause: errors });
console.log(binding.dep, errors.length);`,
  "createRequire read off the call": `require = require("module").createRequire(__filename);\nconsole.log(require("./other.cjs").other, require("dep").dep);`,
  "below a test": `const { createRequire } = require("node:module");\nif (typeof require === "function") require = createRequire(__filename);\nconsole.log(require("./other.cjs").other);`,
  "stored twice": `${head}\nrequire = createRequire(__filename);\nconsole.log(require("./other.cjs").other);`,
  "what else a require has": `${head}\nconsole.log(typeof require, require.resolve("./other.cjs").endsWith("other.cjs"), typeof require.cache, Object.keys(require("./other.cjs")).join());`,
  "a function of the file by that name": `function createRequire() { return name => "made by the file: " + name; }\nrequire = createRequire(__filename);\nconsole.log(require("./other.cjs"));`,
  "in a file that is required": `console.log(require("./loader.cjs").loaded);`,
};
const loader = { "loader.cjs": `${head}\nexports.loaded = require("./other.cjs").other + ", " + require("dep").dep;` };

for (const [title, text] of Object.entries(asPlain)) {
  test.concurrent(title, async () => {
    using dir = tempDir("aot-made-own-require", { ...shared, ...loader, "entry.cjs": text });
    const plain = await run([bunExe(), "entry.cjs"], String(dir), bunEnv);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    await run([bunExe(), "build", "--compile", "--aot", "entry.cjs", "--outfile", "compiled"], String(dir), bunEnv);
    const compiled = await run([`${dir}/compiled`], String(dir), bunEnv);
    expect({ stdout: compiled.stdout, stderr: compiled.stderr, exitCode: compiled.exitCode }).toEqual({
      stdout: plain.stdout,
      stderr: "",
      exitCode: 0,
    });
  });
}

// The file does not keep its own `require` here. Whatever the executable says, it is not the file beside the entry.
const notOwn: Record<string, string> = {
  "made for another folder": `const { createRequire } = require("node:module");\nrequire = createRequire(__dirname + "/sub/x.cjs");\nconsole.log(require("./other.cjs").other);`,
  "one store of two is something else": `${head}\nrequire = createRequire(__dirname + "/sub/x.cjs");\nconsole.log(require("./other.cjs").other);`,
  "a name that may be stored into": `let { createRequire } = require("node:module");\ncreateRequire = () => name => ({ other: "the file of the folder below" });\nrequire = createRequire(__filename);\nconsole.log(require("./other.cjs").other);`,
};

for (const [title, text] of Object.entries(notOwn)) {
  test.concurrent(title, async () => {
    using dir = tempDir("aot-made-own-require", { ...shared, "entry.cjs": text });
    const plain = await run([bunExe(), "entry.cjs"], String(dir), bunEnv);
    expect(plain.stdout).toBe("the file of the folder below\n");
    await run([bunExe(), "build", "--compile", "--aot", "entry.cjs", "--outfile", "compiled"], String(dir), bunEnv);
    const compiled = await run([`${dir}/compiled`], String(dir), bunEnv);
    expect(compiled.stdout).not.toContain("the other file");
    if (compiled.exitCode === 0) expect(compiled.stdout).toBe(plain.stdout);
    else expect(compiled.stderr).toContain("error");
  });
}

test("a test run", async () => {
  using dir = tempDir("aot-made-own-require", {
    ...shared,
    ...loader,
    "uses.test.cjs": `const { test, expect } = require("bun:test");\ntest("loads", () => { expect(require("./loader.cjs").loaded).toBe("the other file, the package"); });`,
  });
  const compiled = await run([bunExe(), "test", "--aot"], String(dir), bunEnv);
  expect(compiled.stderr).toContain("1 pass");
  expect(compiled.exitCode).toBe(0);
});
