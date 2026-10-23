import { expect } from "bun:test";
import { bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { test } from "./supported";

const files = {
  "the-look-of-an-error.cjs": `"use strict";\nconst { inspect } = require("node:util");\nfunction patch(errorConstructor) {\n  const inspectSymbol = Symbol.for("nodejs.util.inspect.custom");\n  errorConstructor.prototype[inspectSymbol] = function () { return "an error that says " + this.message; };\n}\npatch(Error);\nconsole.log(inspect(new Error("one")), inspect(new TypeError("two")), typeof Error.prototype[Symbol.for("nodejs.util.inspect.custom")]);\n`,
  "a-new-name.mjs": `Error.prototype.code = "E_NONE";\nTypeError.prototype.kind = "type";\nconst plain = new Error("a"), typed = new TypeError("b");\nconsole.log(plain.code, typed.code, plain.kind, typed.kind, Object.keys(plain).length, "code" in new RangeError("c"));\n`,
  "what-is-there-is-replaced.mjs": `const made = new RangeError("far");\nconsole.log(String(made), made.name);\nError.prototype.toString = function () { return "<" + this.name + ">"; };\nRangeError.prototype.name = "Range";\nError.prototype.message = "nothing said";\nconsole.log(String(made), made.toString(), \`\${new Error()}\`, new Error().message, new SyntaxError().message, new RangeError("x").name);\n`,
  "deleted-and-defined.mjs": `console.log(delete TypeError.prototype.name, new TypeError("t").name, String(new TypeError("t")));\nObject.defineProperty(Error.prototype, "name", { get() { return "Got " + this.message; }, configurable: true });\nconsole.log(new Error("m").name, new TypeError("n").name, new RangeError("o").name);\nconsole.log(Reflect.deleteProperty(Error.prototype, "name"), new Error("m").name, String(new Error("m")));\n`,
  "classes-that-extend-errors.ts": `class Failure extends Error { constructor(message: string, public code: number) { super(message); } }\nclass Worse extends Failure { override name = "Worse"; }\n(Error.prototype as unknown as { describe(): string }).describe = function (this: Error) { return this.name + "/" + this.message; };\nconst all: Error[] = [new Failure("f", 1), new Worse("w", 2), new TypeError("t")];\nconsole.log(all.map(each => (each as unknown as { describe(): string }).describe()).join(), all.map(each => each instanceof Error && each instanceof Object).join());\nError.prototype.name = "Base";\nconsole.log(all.map(each => each.name).join(), String(all[0]));\n`,
  "feature-tests-are-not-folded.mjs": `console.log(typeof Error.prototype.toJSON, typeof Error.prototype.toString);\nif (!Error.prototype.toJSON) Error.prototype.toJSON = function () { return { name: this.name, message: this.message }; };\nconsole.log(typeof Error.prototype.toJSON, JSON.stringify([new Error("e"), new URIError("u")]));\nconst toString = Error.prototype.toString;\nError.prototype.toString = () => "replaced";\nconsole.log(toString.call(new Error("kept")), Error.prototype.toString.call(new Error("x")), String(new EvalError("y")));\n`,
  "another-prototype.mjs": `const base = { shared: "from the base" };\nObject.setPrototypeOf(Error.prototype, base);\nconsole.log(new Error("e").shared, new TypeError("t").shared, new Error("e") instanceof Object, Object.getPrototypeOf(Error.prototype) === base);\n`,
  "the-constructor-and-its-global-name.cjs": `"use strict";\nconst original = Error;\nError.captureStackTrace = () => "replaced";\nconsole.log(Error.captureStackTrace({}), original.captureStackTrace({}));\nError = function Other() {};\nconsole.log(Error.name, globalThis.Error === Error, Error === original, new original("kept").message, new TypeError("t") instanceof original);\n`,
  "aggregate-suppressed-webassembly.mjs": `AggregateError.prototype.extra = 1;\nSuppressedError.prototype.extra = 2;\nWebAssembly.RuntimeError.prototype.extra = 3;\nconsole.log(new AggregateError([]).extra, new SuppressedError(1, 2).extra, new WebAssembly.RuntimeError("r").extra);\n`,
};
const refused = `"use strict";
const attempts = {
  "the constructor's prototype": () => { TypeError.prototype = {}; },
  "Object.prototype": () => { Object.prototype.extra = 1; },
  "Array.prototype.push": () => { Array.prototype.push = () => {}; },
  "Function.prototype": () => { Function.prototype.extra = 1; },
  "Promise.prototype": () => { Promise.prototype.extra = 1; },
  "Promise.prototype.then": () => { Promise.prototype.then = () => {}; },
};
for (const [what, attempt] of Object.entries(attempts)) {
  try { attempt(); console.log(what, "WAS ALLOWED"); } catch (error) { console.log(what, error.name); }
}
`;

const tsconfigWithTypesOfBun = JSON.stringify({
  compilerOptions: { strict: true, typeRoots: [join(import.meta.dir, "..", "..", "packages")], types: ["bun-types"] },
});

async function run(cwd: string, cmd: string[]) {
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd);
  return { stdout, stderr, exitCode };
}

test.concurrent.each(Object.keys(files))(
  "%s answers under --aot as under plain Bun",
  async entry => {
    using dir = tempDir("aot-error-prototypes", { ...files, "tsconfig.json": tsconfigWithTypesOfBun });
    const plain = await run(String(dir), [bunExe(), "run", `./${entry}`]);
    expect({ stderr: plain.stderr, exitCode: plain.exitCode }).toEqual({ stderr: "", exitCode: 0 });
    expect(plain.stdout).not.toBe("");
    expect(await run(String(dir), [bunExe(), "run", "--debug-aot", `./${entry}`])).toEqual(plain);
    const built = await run(String(dir), [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      `./${entry}`,
      "--outfile",
      `./${entry}.exe`,
    ]);
    expect({ stderr: built.exitCode ? built.stderr : "", exitCode: built.exitCode }).toEqual({
      stderr: "",
      exitCode: 0,
    });
    expect(await run(String(dir), [`./${entry}.exe`])).toEqual(plain);
  },
  120_000,
);

test("the prototype of a constructor and the other prototypes are locked as before", async () => {
  using dir = tempDir("aot-error-prototypes-refused", { "refused.cjs": refused });
  const expected = [
    "the constructor's prototype",
    "Object.prototype",
    "Array.prototype.push",
    "Function.prototype",
    "Promise.prototype",
    "Promise.prototype.then",
  ]
    .map(what => what + " TypeError\n")
    .join("");
  const ran = await run(String(dir), [bunExe(), "run", "--debug-aot", "./refused.cjs"]);
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: expected, exitCode: 0 });
}, 120_000);
