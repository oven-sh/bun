// util.types.isModuleNamespaceObject and util.inspect recognize the namespace object of a compiled module and of a built-in module, and no object that only resembles one.
import { inspect, types } from "node:util";
import * as self from "./util-types-module-namespace.ts";

export const value = 1;
export function double(n: number): number {
  return n * 2;
}

function classify(name: string, candidate: unknown) {
  console.log(name, types.isModuleNamespaceObject(candidate));
}

// Awaited inside a function: at the top level the module would wait for its own evaluation.
async function main(): Promise<void> {
  const namespaces: [string, unknown][] = [
    ["import *", self],
    ["import()", await import("./util-types-module-namespace.ts")],
    ["import() with a computed specifier", await import("./" + ["util-types-module-namespace.ts"][0])],
  ];
  for (const [name, namespace] of namespaces) {
    classify(name, namespace);
    console.log(name, namespace === self, inspect(namespace));
  }
  classify("built-in module", await import("node:" + ["path"][0]));

  classify("spread copy", { ...self });
  classify("null prototype", Object.create(null));
  classify("toStringTag", { [Symbol.toStringTag]: "Module" });
  classify("inheritor", Object.create(self));
  classify("export", self.double);
  classify("null", null);
}
main();
