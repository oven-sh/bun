// `spyOn` cannot replace an export of a compiled module, whichever namespace object interpreted code holds, and that object still follows the compiled variable afterwards. An export of a module loaded at run time can be spied on. The build has --compile-inspector, so the executable loads code that is not in it.
// Flags: --compile-inspector
import { spyOn } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as compiled from "./compiled.ts";

const interpretedImport = new Function('return import("./compiled.ts");');
const interpretedSpyOn = new Function("spyOn", "namespace", "name", "return spyOn(namespace, name);");
const interpretedRead = new Function("namespace", "return namespace.f() + ', ' + namespace.count;");

function attempt(label, namespace, name) {
  try {
    interpretedSpyOn(spyOn, namespace, name);
    console.log(`${label}, ${name}: spied`);
  } catch (error) {
    console.log(`${label}, ${name}: throws ${error.name}`);
  }
}

const resolved = import.meta.resolve("./compiled.ts");
const compiledPath = JSON.stringify(resolved.startsWith("file:") ? fileURLToPath(resolved) : resolved);

const folder = mkdtempSync(join(tmpdir(), "spy-on-compiled-namespace-"));
writeFileSync(
  join(folder, "importer.mjs"),
  `import * as namespace from ${compiledPath};
export const staticNamespace = namespace;
export const dynamicNamespace = await import(${compiledPath});
`,
);
writeFileSync(join(folder, "reexporter.mjs"), `export { f, count } from ${compiledPath};\n`);
writeFileSync(join(folder, "loaded.mjs"), `export function f() {\n  return "real";\n}\n`);

try {
  const importer = await import(join(folder, "importer.mjs"));
  const namespaces = [
    ["import * in compiled code", compiled],
    ["import() in new Function", await interpretedImport()],
    ["import() in a loaded file", importer.dynamicNamespace],
    ["import * in a loaded file", importer.staticNamespace],
    ["export from in a loaded file", await import(join(folder, "reexporter.mjs"))],
  ];
  for (const [label, namespace] of namespaces) {
    attempt(label, namespace, "f");
    attempt(label, namespace, "count");
    console.log(`${label}: ${interpretedRead(namespace)}`);
  }

  compiled.replace(() => "second");
  for (const [label, namespace] of namespaces) console.log(`${label}, after a store: ${interpretedRead(namespace)}`);

  const loaded = await import(join(folder, "loaded.mjs"));
  console.log(`loaded file: ${loaded.f()}`);
  const spy = interpretedSpyOn(spyOn, loaded, "f").mockReturnValue("spied");
  console.log(`loaded file, spied: ${loaded.f()}, calls ${spy.mock.calls.length}`);
  spy.mockRestore();
  console.log(`loaded file, restored: ${loaded.f()}`);
} finally {
  rmSync(folder, { recursive: true, force: true });
}
/* Output:
import * in compiled code, f: throws TypeError
import * in compiled code, count: throws TypeError
import * in compiled code: first, 0
import() in new Function, f: throws TypeError
import() in new Function, count: throws TypeError
import() in new Function: first, 0
import() in a loaded file, f: throws TypeError
import() in a loaded file, count: throws TypeError
import() in a loaded file: first, 0
import * in a loaded file, f: throws TypeError
import * in a loaded file, count: throws TypeError
import * in a loaded file: first, 0
export from in a loaded file, f: throws TypeError
export from in a loaded file, count: throws TypeError
export from in a loaded file: first, 0
import * in compiled code, after a store: second, 1
import() in new Function, after a store: second, 1
import() in a loaded file, after a store: second, 1
import * in a loaded file, after a store: second, 1
export from in a loaded file, after a store: second, 1
loaded file: real
loaded file, spied: spied, calls 1
loaded file, restored: real
*/
