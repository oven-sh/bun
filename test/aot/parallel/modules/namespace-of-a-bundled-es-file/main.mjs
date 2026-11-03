// A file that a bundler made is an ES module: it exports what its `export` statements say. What its `__commonJS` and `__esm` helpers wrap is its own business.
import * as commonjsNamedFunction from "./commonjs-named-function.mjs";
import * as commonjsArrow from "./commonjs-arrow.mjs";
import * as commonjsObjectKeys from "./commonjs-object-keys.mjs";
import * as commonjsAnonymousFunction from "./commonjs-anonymous-function.mjs";
import * as commonjsClearsItsCallback from "./commonjs-clears-its-callback.mjs";
import * as commonjsTryCatch from "./commonjs-try-catch.mjs";
import * as esmArrow from "./esm-arrow.mjs";
import * as esmArrowTryCatch from "./esm-arrow-try-catch.mjs";
import * as esmNamedFunction from "./esm-named-function.mjs";
import * as innerSetsMembers from "./inner-sets-members.mjs";
import * as innerAssignsAnObject from "./inner-assigns-an-object.mjs";
import * as defaultExport from "./default-export.mjs";
import * as madeByBun from "./made-by-bun.mjs";
import * as twoInnerModules from "./two-inner-modules.mjs";
import * as barrel from "./barrel.mjs";
import { x } from "./commonjs-named-function.mjs";
import fromRequire from "./requires-the-bundle.cjs";

function show(name, namespace) {
  const members = Object.keys(namespace).map(key => {
    const value = namespace[key];
    return key + "=" + (typeof value === "function" ? "function that returns " + value() : JSON.stringify(value));
  });
  console.log(name + ":", members.join(", "), "|", Reflect.ownKeys(namespace).length, "default" in namespace, namespace.length, namespace.a);
}
show("commonjs, a named function", commonjsNamedFunction);
show("commonjs, an arrow", commonjsArrow);
show("commonjs, Object.keys", commonjsObjectKeys);
show("commonjs, an anonymous function", commonjsAnonymousFunction);
show("commonjs, clears its callback", commonjsClearsItsCallback);
show("commonjs, try and catch", commonjsTryCatch);
show("esm, an arrow", esmArrow);
show("esm, an arrow with try and catch", esmArrowTryCatch);
show("esm, a named function", esmNamedFunction);
show("the inner module sets members", innerSetsMembers);
show("the inner module assigns an object", innerAssignsAnObject);
show("a default export", defaultExport);
show("made by Bun", madeByBun);
show("two inner modules", twoInnerModules);
show("through a barrel", barrel);
show("the barrel's namespace export", barrel.inner);
show("taken by import()", await import("./taken-by-import-call.mjs"));
const name = ["./esm-arrow", "mjs"].join(".");
show("taken by a name that is made at run time", await import(name));
console.log(x(), commonjsNamedFunction.x === x, commonjsNamedFunction.x(), fromRequire);
