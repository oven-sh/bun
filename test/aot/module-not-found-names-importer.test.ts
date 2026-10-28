import { expect } from "bun:test";
import { mkdirSync, writeFileSync } from "fs";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { run as spawned } from "./harness/run";
import { test } from "./supported";

// "Cannot find module 'x'" names the file that asked for it, in the message or in its "Require stack:", and not the entry point.

const report = `e => [e.name, e.code, e.message, e.requireStack && e.requireStack.join()].join(" | ")`;

const files = {
  "lib/deep/asks.cjs": `const report = ${report};
exports.computed = name => { try { return require(name); } catch (e) { return report(e); } };
exports.literalPackage = () => { try { return require("no-such-package"); } catch (e) { return report(e); } };
exports.literalFile = () => { try { return require("./no-such-file.js"); } catch (e) { return report(e); } };
exports.resolve = () => { try { return require.resolve("no-such-package"); } catch (e) { return report(e); } };
exports.nearby = () => { try { return require("only-nearby").where; } catch (e) { return report(e); } };
exports.builtin = () => typeof require("fs").readFileSync + " " + typeof require("node:path").join + " " + typeof require("buffer").Buffer;
`,
  "lib/deep/asks.mjs": `const report = ${report};
export const computed = async name => { try { return await import(name); } catch (e) { return report(e); } };
export const literalPackage = async () => { try { return await import("no-such-package"); } catch (e) { return report(e); } };
export const literalFile = async () => { try { return await import("./no-such-file.js"); } catch (e) { return report(e); } };
export const resolve = () => { try { return import.meta.resolve("no-such-package"); } catch (e) { return report(e); } };
`,
  "main.mjs": `import cjs from "./lib/deep/asks.cjs";
import * as esm from "./lib/deep/asks.mjs";
const say = (what, v) => console.log(what + ":", String(v).replaceAll("\\n", " ~ ").replaceAll(process.cwd(), "<cwd>").replaceAll("/private<cwd>", "<cwd>"));
say("require(computed package)", cjs.computed("no-such-" + "package"));
say("require(computed file)", cjs.computed("./no-such-" + "file.js"));
say("require(literal package)", cjs.literalPackage());
say("require(literal file)", cjs.literalFile());
say("require.resolve", cjs.resolve());
say("require(built-in)", cjs.builtin());
say("import(computed package)", await esm.computed("no-such-" + "package"));
say("import(computed file)", await esm.computed("./no-such-" + "file.js"));
say("import(literal package)", await esm.literalPackage());
say("import(literal file)", await esm.literalFile());
say("import.meta.resolve", esm.resolve());
`,
};

test("bun run --aot names the same file as bun run", async () => {
  using dir = tempDir("module-not-found", files);
  const plain = await spawned([bunExe(), "run", "main.mjs"], String(dir));
  const aot = await spawned([bunExe(), "run", "--debug-aot", "main.mjs"], String(dir));
  expect(plain.stdout).toContain(
    "require(literal package): ResolveMessage | MODULE_NOT_FOUND | Cannot find module 'no-such-package' ~ Require stack: ~ - " +
      join("<cwd>", "lib", "deep", "asks.cjs"),
  );
  expect(aot.stdout).toBe(plain.stdout);
  expect(aot.exitCode).toBe(0);
});

test("bun build --compile --aot names the same file as bun run, by its path in the executable", async () => {
  using dir = tempDir("module-not-found", files);
  const plain = await spawned([bunExe(), "run", "main.mjs"], String(dir));
  const built = await spawned(
    [bunExe(), "build", "--compile", "--aot", "main.mjs", "--outfile", "program"],
    String(dir),
  );
  expect(built.exitCode).toBe(0);
  const ran = await spawned([join(String(dir), "program")], String(dir));
  expect(ran.stdout).toBe(plain.stdout.replaceAll("<cwd>", isWindows ? "B:\\~BUN\\root" : "/$bunfs/root"));
  expect(ran.exitCode).toBe(0);
});

test("bun run --aot does not load a package that appears later, and names the file that requires it", async () => {
  using dir = tempDir("module-not-found", {
    ...files,
    "late.mjs": `import { mkdirSync, writeFileSync } from "node:fs";
import cjs from "./lib/deep/asks.cjs";
mkdirSync("lib/deep/node_modules/only-nearby", { recursive: true });
writeFileSync("lib/deep/node_modules/only-nearby/index.js", "exports.where = 'beside the file that requires it';");
console.log(cjs.nearby());
`,
  });
  // Code that was not there when the program was compiled is not part of it.
  const aot = await spawned([bunExe(), "run", "--debug-aot", "late.mjs"], String(dir));
  expect(aot.stdout).toContain("Cannot find module 'only-nearby' from ");
  expect(aot.stdout).toContain(join("lib", "deep", "asks.cjs"));
  expect(aot.exitCode).toBe(0);
  expect((await spawned([bunExe(), "run", "late.mjs"], String(dir))).stdout).toBe("beside the file that requires it\n");
});

test("an executable gives the error for a package that appears later the code of a load that finds nothing", async () => {
  using dir = tempDir("module-not-found", {
    "main.cjs": `function optional() {
  try { return require("optional-thing"); } catch (e) { if (e.code !== "MODULE_NOT_FOUND") throw e; return null; }
}
console.log("require:", optional());
try { require.resolve("optional-thing"); } catch (e) { console.log("require.resolve:", e.code); }
import("optional-thing").catch(e => console.log("import:", e.code));
`,
  });
  const built = await spawned(
    [bunExe(), "build", "--compile", "--aot", "main.cjs", "--outfile", "program"],
    String(dir),
  );
  expect(built.exitCode).toBe(0);
  const expected = "require: null\nrequire.resolve: MODULE_NOT_FOUND\nimport: ERR_MODULE_NOT_FOUND\n";
  const before = await spawned([join(String(dir), "program")], String(dir));
  expect({ stdout: before.stdout, exitCode: before.exitCode }).toEqual({ stdout: expected, exitCode: 0 });
  mkdirSync(join(String(dir), "node_modules", "optional-thing"), { recursive: true });
  writeFileSync(join(String(dir), "node_modules", "optional-thing", "index.js"), "module.exports = 'here';");
  const after = await spawned([join(String(dir), "program")], String(dir));
  expect({ stdout: after.stdout, exitCode: after.exitCode }).toEqual({ stdout: expected, exitCode: 0 });
});
