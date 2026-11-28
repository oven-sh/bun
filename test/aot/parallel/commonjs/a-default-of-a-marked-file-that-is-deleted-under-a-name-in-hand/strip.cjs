"use strict";
for (const name of ["default", "late"]) delete require("./weights.cjs")[name];
Reflect.deleteProperty(require("./tallies.cjs"), "default");
function drop(object, name) {
  delete object[name];
}
drop(require("./rooms.cjs"), "default");
drop(require("./shelf.cjs"), "default");
drop(require("./handed.cjs"), "default");
for (const name in require("./emptied.cjs")) require("./emptied.cjs")[name] = undefined;
drop(require("./untouched.cjs"), "other");
