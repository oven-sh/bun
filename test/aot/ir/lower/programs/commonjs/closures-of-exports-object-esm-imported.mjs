// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 2
// CHECK-LABEL: function {{*}}name="key"
// CHECK-LABEL: function {{*}}name="get"

// FILE: main.mjs
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

// FILE: lib.cjs
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.lib = factory();
})(this, function () {
  var calls = 0;
  return {
    used: function () { return "used " + ++calls; },
    wrapped: function () { return "wrapped " + ++calls; },
    replaced: function () { return "replaced " + ++calls; },
    deleted: function () { return "deleted " + ++calls; },
    redefined: function () { return "redefined " + ++calls; },
    readThenDeleted: function () { return "readThenDeleted " + ++calls; },
    untouched: function () { return "untouched " + ++calls; },
    neverAsked: function () { return "neverAsked " + ++calls; },
  };
});

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }
