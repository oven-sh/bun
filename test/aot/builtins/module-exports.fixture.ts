// module-exports.test.ts runs this in a process of its own and reads what it prints. The loader fills the namespace of a module of Bun when the module is first imported,
// and a getter on the object of the module may answer something else later: `tmpdir` of node:os puts another function in its own place at its first call.
// So the question is asked where nothing has used the modules yet.
import { readFileSync } from "node:fs";
import { parseModuleExports, type ListedExport, type ListedModule } from "../../../src/codegen/builtins/collect-modules";

// Compiled code reads an import of a module of Bun from where the file says the value is, so this asks the loader of the Bun under test.
function findHolder(name: string, namespace: Record<string, unknown>, moduleObject: unknown): ListedExport["holder"] {
  if (name === "default" && namespace.default === moduleObject) return "ModuleObject";
  const isHolder = (typeof moduleObject === "object" && moduleObject !== null) || typeof moduleObject === "function";
  return isHolder && Object.is(namespace[name], (moduleObject as Record<string, unknown>)[name])
    ? "Property"
    : "Namespace";
}

export async function observe(specifier: string, listed: ListedModule): Promise<ListedModule> {
  const namespace = await import(specifier);
  const moduleObject = require(specifier);
  return {
    isFunction: typeof moduleObject === "function",
    exports: listed.exports.map(entry =>
      entry.name in namespace ? { name: entry.name, holder: findHolder(entry.name, namespace, moduleObject) } : entry,
    ),
  };
}

if (import.meta.main) {
  const [dataFile, fileName] = process.argv.slice(2);
  const observed: [string, ListedModule][] = [];
  for (const [specifier, listed] of parseModuleExports(readFileSync(dataFile, "utf8"), fileName)) {
    // Only the test runner has it.
    if (specifier !== "bun:test") observed.push([specifier, await observe(specifier, listed)]);
  }
  console.log(JSON.stringify(observed));
}
