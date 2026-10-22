// Modules that call something like SWC's `_export(exports, { .. })`, each a little off the form: what a reader of the names and a look at the object find is what plain Bun finds.
"use strict";
function look(read) { try { const value = read(); return typeof value === "function" ? "function " + value.name : String(value); } catch (error) { return error.name + ": " + error.message; } }

const _live = require("./live-binding.cjs");
console.log("live binding", _live.a, (0, _live.bump)(), _live.a);

const _effects = require("./getter-with-effects.cjs");
console.log("getter with effects", _effects.a, _effects.a, (0, _effects.reads)());

const _hidden = require("./not-enumerable.cjs");
console.log("not enumerable", _hidden.a, Object.keys(_hidden).join());

const _open = require("./configurable.cjs");
console.log("configurable", _open.a, delete _open.a, _open.a);

const _swapped = require("./helper-replaced.cjs");
console.log("helper replaced", look(() => _swapped.a), look(() => _swapped.b));

const _late = require("./called-late.cjs");
console.log("called late", look(() => _late.a), (0, _late.define)(), look(() => _late.a));

const _other = require("./another-target.cjs");
console.log("another target", look(() => _other.a), look(() => _other.holder.a));

const _order = require("./order-of-names.cjs");
console.log("order of names", _order.b, _order.a, _order[1], _order[0]);
console.log("order of names, looked at", Object.keys(require("./order-of-names-looked-at.cjs")).join());

console.log("no getter", look(() => require("./value-in-place-of-a-getter.cjs").a));

const _stored = require("./stored-behind-the-definition.cjs");
console.log("stored behind the definition", look(() => _stored.a), look(() => _stored.result));

console.log("defined twice", look(() => require("./defined-twice.cjs").a));

const _shadow = require("./object-shadowed.cjs");
console.log("Object shadowed", look(() => _shadow.a), _shadow.calls);
