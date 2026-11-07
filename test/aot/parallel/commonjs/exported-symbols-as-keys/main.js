// Symbols that a CommonJS module makes and exports in `module.exports = { .. }`, taken out by other modules and used as keys: by name where the module only makes values, and the same answers wherever it does more.
// IR= 0 Thing ElemSet
// IR= 0 bump ElemGet
// IR= 0 bump ElemSet
// IR= 0 throughTheObject ElemGet
// IR= 1 underWhatACallMade ElemGet
"use strict";
const lines = [];
function show(what, value) { lines.push(what + ": " + String(value)); }
function outcome(run) { try { return String(run()); } catch (error) { return error.constructor.name; } }

show("before the module has run", outcome(() => throughTheObject({})));

const { kState, kCount, kShared, kBare } = require("./keys");
const keys = require("./keys");
const { kMade, kPlain } = require("./keys-behind-a-call");

function Thing(value) {
    this[kState] = value;
    this[kCount] = 0;
    this.plain = value;
    this[kBare] = "bare";
}
Thing.prototype.bump = function bump() {
    this[kCount] = this[kCount] + 1;
    return this[kState];
};
function throughTheObject(thing) { return thing[keys.kCount]; }
function underWhatACallMade(thing) { return thing[kMade]; }

let total = 0;
let last;
for (let i = 0; i < 300; i++) {
    last = new Thing(i);
    last[kMade] = 1;
    total += last.bump() + last.bump() + throughTheObject(last) + underWhatACallMade(last);
}
show("total", total);
show("functions that are values too", [Thing, throughTheObject, underWhatACallMade].map(kept => kept.name).join());
show("called as a value", [underWhatACallMade].map(kept => kept(last)).join());
show("the same however it is asked for", [keys.kState === kState, keys.kCount === kCount, require("./keys").kShared === kShared, kShared === Symbol.for("shared by its text")].join());
show("texts", [kState, kCount, kShared, kBare, kMade, kPlain].map(String).join());
show("own symbols", Object.getOwnPropertySymbols(last).map(String).join());
show("the symbols listed are the constants", Object.getOwnPropertySymbols(last).every((symbol, index) => symbol === [kState, kCount, kBare, kMade][index]));
show("absent", [last[kPlain], last[kShared], kPlain in last, kState in last, typeof keys.absent].join());
show("inherited", [Object.create(last)[kState], Object.create(last)[kBare]].join());
function readBy(object, key) { return object[key]; }
show("by a key that is handed over", [readBy(last, kState), readBy(last, keys.kCount), readBy(last, Object.getOwnPropertySymbols(last)[2])].join());

const other = require("./another-user");
show("another module sees the same", [other.stateOf(last), other.countOf(last), other.kState === kState].join());
other.store(last, "stored elsewhere");
show("stored elsewhere", last[kState]);

const lazily = require("./required-in-a-function");
show("required in a function", [lazily.read(last), lazily.read(last)].join());
show("a module that reads its own exports while it runs", require("./reads-its-own-exports").told.join());
show("two stores to one name", [String(require("./stored-twice").kTwice), last[require("./stored-twice").kTwice]].join());
console.log(lines.join("\n"));
