// `mock.module()` cannot replace a module that was compiled with the program: it throws a TypeError, and the module stays what it was. A module that is loaded at run time is mocked as in plain Bun. The build has --compile-inspector, so the executable loads code that is not in it.
import { mock } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { greet } from "./compiled.js";

function attempt(label, specifier) {
  try {
    mock.module(specifier, () => ({ greet: () => "mocked" }));
    console.log(label + ": mocked");
  } catch (error) {
    console.log(label + ": throws " + error.name);
  }
}

attempt("a compiled module", "./compiled.js");
console.log("its binding afterwards:", greet());
console.log("import() of it afterwards:", (await import("./compiled.js")).greet());

const folder = mkdtempSync(join(tmpdir(), "mock-module-of-compiled-module-"));
try {
  const loaded = join(folder, "loaded.mjs");
  writeFileSync(loaded, `export function greet() {\n  return "real";\n}\n`);
  attempt("a module that is loaded at run time", loaded);
  console.log("import() of it afterwards:", (await import(loaded)).greet());
} finally {
  rmSync(folder, { recursive: true, force: true });
}
