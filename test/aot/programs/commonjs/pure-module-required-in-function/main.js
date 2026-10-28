// A CommonJS module whose body only makes values runs no code but its own, so nobody gets at it while it is evaluated: it keeps its exports in variables although a function requires it, and its symbols are names.
// IR+ ^variable g\d+ name="onlyReadThroughTheObject" module=
// IR= 0 stamp ElemSet
// IR= 0 read ElemGet
"use strict";
const lines = [];
function show(what, value) { lines.push(what + ": " + String(value)); }
function stamp(object, value) {
    const { kLate } = require("./keys");
    object[kLate] = value;
    return object;
}
function read(object) {
    const keys = require("./keys");
    return object[keys.kLate];
}
show("before anything has required it", typeof globalThis.evaluations);
let total = 0;
for (let i = 0; i < 300; i++) total += read(stamp({}, i));
show("total", total);
show("functions that are values too", [stamp, read].map(kept => kept.name).join());
show("the same each time", require("./keys").kLate === require("./keys").kLate);
show("what else it exports", [require("./keys").onlyReadThroughTheObject, typeof require("./keys").absent].join());
const user = require("./a-user-required-in-a-function");
show("through a module that a function requires", [user.load().readLate(stamp({}, "late")), String(user.load().kLate)].join());
const busy = require("./a-module-that-calls-out");
show("a module that calls out while it is evaluated", busy.seen.join());
console.log(lines.join("\n"));
