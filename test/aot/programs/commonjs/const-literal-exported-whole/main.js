// `const keys = { .. }; module.exports = keys`: what the module exports is the literal, whoever asks and however, and symbols made there are keys like any other.
// IR+ ^variable g\d+ name="onlyReadThroughTheObject" module=
"use strict";
const lines = [];
function show(what, value) { lines.push(what + ": " + String(value)); }
function outcome(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }

const { kState, kCount, kShared, limit, double } = require("./keys");
const keys = require("./keys.js");

function Thing(value) {
    this[kState] = value;
    this[kCount] = 0;
    this.plain = value;
}
Thing.prototype.bump = function bump() {
    this[kCount] = this[kCount] + 1;
    return this[kState];
};

let total = 0;
let last;
for (let i = 0; i < 300; i++) {
    last = new Thing(i);
    total += last.bump() + last.bump() + last[keys.kCount];
}
show("total", total);
show("the same however it is asked for", [keys.kState === kState, keys.kCount === kCount, require("./keys").kShared === kShared, kShared === Symbol.for("shared by its text")].join());
show("texts", [String(kState), String(kCount), String(kShared)].join());
show("own symbols", Object.getOwnPropertySymbols(last).map(String).join());
show("the symbols listed are the constants", Object.getOwnPropertySymbols(last).every((symbol, index) => symbol === [kState, kCount][index]));
show("what else it exports", [limit, double(limit), keys.limit, keys.double(4), typeof keys.absent, keys.onlyReadThroughTheObject].join());

const changed = require("./changed-later");
show("stored to from outside", [String(changed.read().kFirst), changed.read().kFirst === changed.before, changed.read().added].join());
const listed = require("./listed");
show("listed", [Object.keys(listed.keys).join(), listed.keys.kOnly === listed.again().kOnly, String(listed.keys.kOnly)].join());
const used = require("./used-by-its-own-module");
show("used by its own module", [used.exported.kOwn === used.own(), String(used.own())].join());
const between = require("./something-in-between");
show("something in between", [between.seen, String(between.keys.kLate)].join());
const twice = require("./reassigned");
show("reassigned", [String(twice.kSecond), typeof twice.kFirst].join());
show("a cycle", require("./cycle-a").told.join());
console.log(lines.join("\n"));
