// An ES importer holds what a CommonJS file exported when it was first imported, whatever happens to the exports object afterwards.
import lib, { used } from "./lib.cjs";
const key = name => (process.argv.length > 99 ? "other" : name);
console.log(used(), lib.used === used);

const original = lib[key("wrapped")];
lib[key("wrapped")] = function () { return "[" + original() + "]"; };
lib[key("replaced")] = function () { return "another function"; };
delete lib[key("deleted")];
Object.defineProperty(lib, key("redefined"), { get() { return "a getter"; }, configurable: true, enumerable: true });
const seen = lib[key("readThenDeleted")];
delete lib[key("readThenDeleted")];

const namespace = await import("./lib.cjs");
console.log(namespace.wrapped === original, namespace.wrapped(), lib.wrapped());
console.log(typeof namespace.replaced, namespace.replaced(), lib.replaced(), namespace.replaced === lib.replaced);
console.log(typeof namespace.deleted, namespace.deleted(), "deleted" in lib);
console.log(typeof namespace.redefined, namespace.redefined(), lib.redefined);
console.log(namespace.readThenDeleted === seen, namespace.readThenDeleted(), "readThenDeleted" in lib);
console.log(namespace.untouched === lib.untouched, namespace.untouched(), lib.untouched());
console.log(namespace.default === lib, namespace.used === used);
console.log(Object.keys(namespace).sort().join());
console.log(Object.keys(lib).join());
const again = await import("./lib.cjs");
console.log(again === namespace, again.replaced === namespace.replaced, again.deleted === namespace.deleted);
