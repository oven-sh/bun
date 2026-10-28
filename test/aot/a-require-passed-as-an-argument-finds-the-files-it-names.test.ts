// A file hands its own `require` to a function, and the function calls its parameter with a name that is written there. The wrapper that
// TypeScript writes for `"module": "umd"` does so: `(function (factory) { .. factory(require, exports) .. })(function (require, exports) { .. require("./part") .. })`.
// The build follows the parameter of a function expression that is called where it is written, or that a function called where it is written calls. What the name stands for, from the folder
// of the file whose `require` it is, is compiled like any other file that is required. The call tests what the parameter holds, so another function in its place is called as it is.
// BUN_JSC_crashIfInterpreterIsUsed=1 ends a compiled program that interprets anything. The executable runs away from its sources.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const wrapped = (names: string[], body: string) => `(function (factory) {
    if (typeof module === "object" && typeof module.exports === "object") {
        var v = factory(require, exports);
        if (v !== undefined) module.exports = v;
    }
    else if (typeof define === "function" && define.amd) {
        define(["require", "exports", ${names.map(name => JSON.stringify(name)).join(", ")}], factory);
    }
})(function (require, exports) {
    "use strict";
    Object.defineProperty(exports, "__esModule", { value: true });
${body}
});
`;

const files = {
  "tsconfig.json": `{ "compilerOptions": { "module": "preserve", "moduleResolution": "bundler", "allowJs": true } }`,
  "lib/one.js": `exports.name = "one";\n`,
  "lib/two.js": `exports.name = "two";\n`,
  "node_modules/wrapped/package.json": `{ "name": "wrapped", "version": "1.0.0", "main": "./lib/main.js" }`,
  "node_modules/wrapped/lib/main.js": wrapped(
    ["./parts/join", "./parts/split"],
    `    const join_1 = require("./parts/join");
    const split_1 = require("./parts/split");
    exports.format = text => (0, join_1.join)((0, split_1.split)(text));`,
  ),
  "node_modules/wrapped/lib/parts/join.js": wrapped(
    ["./split"],
    `    const split_1 = require("./split");
    exports.join = parts => parts.join("|") + ":" + typeof split_1.split;`,
  ),
  "node_modules/wrapped/lib/parts/split.js": wrapped([], `    exports.split = text => text.split(" ");`),
};

const programs: Record<string, string> = {
  "a-wrapped-package-required.cjs": `console.log(require("wrapped").format("a b c"));\n`,
  "a-wrapped-package-imported.mjs": `import { format } from "wrapped";\nconsole.log(format("a b c"));\n`,
  "a-function-called-where-it-is-written.cjs": `(function (load, out) { out.push(load("./lib/one").name); })(require, (globalThis.out = []));\nconsole.log(out.join());\n`,
  "an-arrow-function-called-where-it-is-written.cjs": `console.log((load => load("./lib/one").name + load("./lib/two.js").name)(require));\n`,
  "a-parameter-passed-on.cjs": `(function (outer) { console.log((function (inner) { return inner("./lib/two").name; })(outer) + outer("./lib/one").name); })(require);\n`,
  "through-call-and-apply.cjs": `(function (load) { console.log(load.call(null, "./lib/one").name + load.apply(null, ["./lib/two"]).name); })(require);\n`,
  "another-function-for-the-same-parameter.cjs": `(function (use) { console.log(use(require), use(() => ({ name: "mine" }))); })(function (load) { return load("./lib/one").name; });\n`,
  "a-function-that-other-hands-call-too.cjs": `globalThis.later = [];
(function (use) { later.push(use); console.log(use(require)); })(function (load) { return load("./lib/one").name; });
console.log(later[0](name => ({ name })));
`,
  "a-name-that-stands-for-nothing.cjs": `console.log((function (load) { try { return load("./lib/absent").name; } catch (error) { return error.code; } })(require));\n`,
};

const compiledOnly = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

describe.concurrent.each(Object.keys(programs))("%s", entry => {
  const tree = { ...files, [entry]: programs[entry] };

  test("in place of its files", async () => {
    using dir = tempDir("require-as-an-argument", tree);
    const plain = await run([bunExe(), "run", entry], String(dir));
    expect(plain.exitCode).toBe(0);
    const compiled = await run([bunExe(), "run", "--debug-aot", entry], String(dir), compiledOnly);
    expect(compiled.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  }, 120_000);

  test("in an executable", async () => {
    using dir = tempDir("require-as-an-argument", tree);
    using elsewhere = tempDir("require-as-an-argument-elsewhere", {});
    const plain = await run([bunExe(), "run", entry], String(dir));
    const executable = join(String(elsewhere), "program");
    const built = await run([bunExe(), "build", "--compile", "--aot", entry, "--outfile", executable], String(dir));
    expect(built.stderr).not.toContain("error:");
    expect(built.exitCode).toBe(0);
    const compiled = await run([executable], String(elsewhere), compiledOnly);
    expect(compiled.stderr).not.toContain("crashIfInterpreterIsUsed");
    expect({ stdout: compiled.stdout, exitCode: compiled.exitCode }).toEqual({ stdout: plain.stdout, exitCode: 0 });
  }, 120_000);
});
