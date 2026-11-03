// A file without import or export is CommonJS if it uses require, module, exports or the like, and an ES module otherwise.
// `bun run --define` decides that after it has put the values in and removed the arms that they rule out. So does an executable.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { spawned, unsupported } from "./harness/commands";

const flags = [
  `--define=process.env.NODE_ENV="production"`,
  "--define=OFF=false",
  "--define=ON=true",
  "--define=LEVEL=3",
  "--define=NOTHING=null",
  "--define=ABSENT=undefined",
  `--define=NAME="a"`,
  `--define=CONFIG={"a":1}`,
  "--define=LIST=[1,0]",
  "--define=settings.debug=false",
  `--define=process.platform="plan9"`,
  "--define=RUNTIME=Bun",
];

// In a script `this` of a plain call is the global object and a store to an undeclared name makes a global variable.
const saysItsKind = (name: string) => `
function typeOfThis() { return typeof this; }
let stored;
try { undeclared = 1; stored = "stored"; delete globalThis.undeclared; } catch (error) { stored = error.name; }
(globalThis.kinds ??= []).push("${name} " + typeOfThis() + " " + stored);
`;

const modules = [
  `if (process.env.NODE_ENV !== "production") { require("node:path"); }`,
  `if (process.env.NODE_ENV != "production") require("node:path");`,
  `process.env.NODE_ENV === "production" || require("node:path");`,
  `process.env.NODE_ENV !== "production" && require("node:path");`,
  `const path = process.env.NODE_ENV === "production" ? null : require("node:path");`,
  `const mode = process.env.NODE_ENV; if (mode !== "production") { require("node:path"); }`,
  `function f() { if (process.env.NODE_ENV !== "production") { return require("node:path"); } } f();`,
  `const f = () => process.env.NODE_ENV !== "production" && module.exports; f();`,
  `if (typeof process.env.NODE_ENV !== "string") { require("node:path"); }`,
  `if ("a" + process.env.NODE_ENV !== "aproduction") { require("node:path"); }`,
  `process.env.NODE_ENV ?? require("node:path");`,
  `if (process.env.NODE_ENV !== "production") { module.exports = 1; }`,
  `if (process.env.NODE_ENV !== "production") { exports.a = 1; }`,
  `if (process.env.NODE_ENV !== "production") { this.a = 1; }`,
  `if (process.env.NODE_ENV !== "production") { console.log(__dirname, __filename); }`,
  `if (process.env.NODE_ENV !== "production") { var a = require("node:path"); }`,
  `if (Math.random() > 2 && process.env.NODE_ENV !== "production") { require("node:path"); }`,
  `if (OFF) { require("node:path"); }`,
  `if (!ON) { require("node:path"); }`,
  `OFF && module.exports;`,
  `ON || module.exports;`,
  `OFF ? exports.a = 1 : 0;`,
  `if (OFF == 1) { require("node:path"); }`,
  `if (typeof OFF === "undefined") { require("node:path"); }`,
  `const a = OFF, b = a; if (b) { require("node:path"); }`,
  `const a = OFF ? 1 : 2; if (a === 1) { require("node:path"); }`,
  `function f() { const a = OFF; if (a) { require("node:path"); } } f();`,
  `if (LEVEL - 3) { require("node:path"); }`,
  `if (LEVEL > 4) { require("node:path"); }`,
  `if (NOTHING != null) { require("node:path"); }`,
  `if (ABSENT !== undefined) { require("node:path"); }`,
  `if (NAME === "b") { require("node:path"); }`,
  `if (settings.debug) { require("node:path"); }`,
  `if (process.platform !== "plan9") { require("node:path"); }`,
  `if (OFF && process.arch === "${process.arch}") { require("node:path"); }`,
  `if (process.arch === "${process.arch}" && OFF) { require("node:path"); }`,
  `if (!CONFIG) { require("node:path"); }`,
  `CONFIG || require("node:path");`,
  `CONFIG ?? require("node:path");`,
  `if (!LIST) { require("node:path"); }`,
];

const scripts = [
  `if (process.env.NODE_ENV === "production") { require("node:path"); }`,
  `if (process.env.NODE_ENV !== "production") { require("node:path"); } else { require("node:fs"); }`,
  `if (process.env?.NODE_ENV !== "production") { require("node:path"); }`,
  `if (globalThis.process.env.NODE_ENV !== "production") { require("node:path"); }`,
  `let mode = process.env.NODE_ENV; if (mode !== "production") { require("node:path"); }`,
  `f(); const mode = process.env.NODE_ENV; if (mode !== "production") { require("node:path"); } function f() {}`,
  `function f(process) { if (process.env.NODE_ENV !== "production") { require("node:path"); } } f({ env: {} });`,
  `if (ON) { require("node:path"); }`,
  `var OFF; if (OFF) { require("node:path"); }`,
  `if (globalThis.OFF) { require("node:path"); }`,
  `ABSENT ?? require("node:path");`,
  `if (typeof settings === "undefined") { require("node:path"); }`,
  `if (typeof RUNTIME === "undefined") { require("node:path"); }`,
  `if (!RUNTIME) { require("node:path"); }`,
  // What a build knows by itself. `bun run` does not look at it.
  `if (process.env.BUN_ENV === "nowhere") { require("node:path"); }`,
  `if (process.arch === "nothing") { require("node:path"); }`,
  `if (!process.versions.bun) { require("node:path"); }`,
  `if (typeof Bun === "undefined") { require("node:path"); }`,
  `if (OFF || process.arch === "nothing") { require("node:path"); }`,
  `if (ON && process.arch === "nothing") { require("node:path"); }`,
];

const name = (kind: string, index: number) => `${kind}-${String(index).padStart(2, "0")}`;
const files: Record<string, string> = {};
modules.forEach((text, index) => (files[name("module", index) + ".js"] = text + saysItsKind(name("module", index))));
scripts.forEach((text, index) => (files[name("script", index) + ".js"] = text + saysItsKind(name("script", index))));
const expected = [
  "main undefined ReferenceError",
  ...modules.map((_, index) => name("module", index) + " undefined ReferenceError"),
  ...scripts.map((_, index) => name("script", index) + " object stored"),
];

test.skipIf(unsupported)(
  "the kind of a file goes by what is left of it behind the defines, as in bun run with the same defines",
  async () => {
    using dir = tempDir("aot-kind-behind-defines", {
      ...files,
      "main.js":
        `if (process.env.NODE_ENV !== "production") { require("node:path"); }` +
        saysItsKind("main") +
        `import("./all.mjs").then(() => console.log(globalThis.kinds.sort().join("\\n")));\n`,
      "all.mjs": Object.keys(files)
        .map(file => `import "./${file}";\n`)
        .join(""),
    });
    const cwd = String(dir);
    const { NODE_ENV, BUN_ENV, ...env } = bunEnv;
    const printed = { stdout: expected.join("\n") + "\n", exitCode: 0 };
    expect(await spawned([bunExe(), "run", ...flags, "main.js"], cwd, env)).toMatchObject(printed);
    const executable = join(cwd, "main" + (isWindows ? ".exe" : ""));
    expect(
      await spawned([bunExe(), "build", "--compile", "--aot", ...flags, "main.js", "--outfile", executable], cwd, env),
    ).toMatchObject({ exitCode: 0 });
    expect(await spawned([executable], cwd, env)).toMatchObject(printed);
  },
  240_000,
);

test.skipIf(unsupported)(
  "without the define the same file is a script",
  async () => {
    using dir = tempDir("aot-kind-without-defines", {
      "main.js":
        `if (process.env.NODE_ENV !== "production") { require("node:path"); }` +
        saysItsKind("main") +
        `console.log(globalThis.kinds.join("\\n"));\n`,
    });
    const cwd = String(dir);
    const { NODE_ENV, BUN_ENV, ...env } = bunEnv;
    const printed = { stdout: "main object stored\n", exitCode: 0 };
    expect(await spawned([bunExe(), "run", "main.js"], cwd, env)).toMatchObject(printed);
    const executable = join(cwd, "main" + (isWindows ? ".exe" : ""));
    expect(
      await spawned([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", executable], cwd, env),
    ).toMatchObject({ exitCode: 0 });
    expect(await spawned([executable], cwd, env)).toMatchObject(printed);
  },
  240_000,
);
