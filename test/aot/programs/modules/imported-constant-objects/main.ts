// Objects that a module exports as `const` are read and changed from other modules: static and dynamic imports, `export *`, namespaces, cycles, `require`.
import { seenEarly, readCyclicLiteral, readCyclicMade } from "./cycle-a";
import Defaulted, { readDefaulted } from "./defaulted";
import { foo } from "./helper";
import { Kind, Made, kindOf, secondMade } from "./kinds";
import {
  DefinedByImporter,
  DefinedInHelper,
  IndexedByImporter,
  ListedByImporter,
  WrittenByImporter,
  readAll,
} from "./mutated";
import * as namespace from "./namespaced";
import { Renamed, Starred, readStarred } from "./reexports";

function usesKind(x: string, flags: number) {
  return [x === Kind.Tool, flags & Kind.Count, Kind.Enabled, Kind.Nothing, (Kind as any).missing, Renamed.User].join();
}
console.log("static import:", usesKind("tool", 7), usesKind("user", 1), kindOf("user"), kindOf("tool"), kindOf("x"));
console.log("values made at run time:", Made.first.n, secondMade(), Made.literal);
console.log("export *:", Starred.a, Starred.b, readStarred());

console.log("namespace, before:", namespace.readInNamespace());
namespace.InNamespace.a = 5;
for (const name of Object.keys(namespace)) {
  const value = (namespace as any)[name];
  if (typeof value === "object") value.a *= 2;
}
console.log("namespace, after:", namespace.readInNamespace());

const lazy = await import("./lazy");
console.log("dynamic import, before:", lazy.readLazy());
lazy.Lazy.a = 7;
(lazy as any)["Lazy" + "ByKey"].a = 700;
console.log("dynamic import, after:", lazy.readLazy());

const required = require("./required.ts");
console.log("require, before:", required.readRequired());
required.Required.a = 9;
console.log("require, after:", required.readRequired());

console.log("default export, before:", readDefaulted());
Defaulted.a = 11;
console.log("default export, after:", readDefaulted());

console.log("importer, before:", readAll());
WrittenByImporter.a = 3;
Object.defineProperty(DefinedByImporter, "a", { get: () => 4 });
foo(DefinedInHelper, { a: { value: 5 } });
console.log("importer, after:", readAll(), Object.keys(ListedByImporter).join(), (IndexedByImporter as any)["b"]);

console.log("cycle:", seenEarly, readCyclicLiteral(), readCyclicMade());
