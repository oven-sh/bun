// RUN: lower
// OPTIONS: builtin-modules
// STATISTIC: SourceFilesInferred = 25

// FILE: main.js
// CommonJS modules in the form esbuild gives to what was an ES module: `__export(x, { name: () => local })` and `module.exports = __toCommonJS(x)`.
function row(label, f) { let said; try { said = f(); } catch (e) { said = "threw " + e.name; } console.log(label + ": " + (typeof said === "function" ? "F" : String(said))); }
const plain = require("./files/plain.js");
row("a function", () => plain.add(2, 3));
row("a variable", () => plain.limit);
row("a class", () => new plain.Shape(4).describe());
row("an enum", () => plain.Kind.Square + " " + plain.Kind[0]);
row("an object that calls", () => plain.table.one + plain.table.two);
row("another name", () => plain.renamed());
row("default", () => plain.default() + " " + plain.default.name);
row("the marker", () => plain.__esModule);
row("a name that is not there", () => plain.missing);
const { add, limit: bound, missing = "a default" } = require("./files/plain.js");
row("a pattern", () => add(bound, 1) + " " + missing);
const live = require("./files/live.js");
row("a binding that a function stores to", () => [live.count, live.increment(), live.count, live.increment(), live.count].join());
const state = require("./files/stored_by_a_function.js");
row("stored to by a call from outside", () => { const before = state.state; state.set("second"); return before + " " + state.state; });
const field = require("./files/stored_by_a_field.js");
row("stored to by a field and by a default", () => { const before = field.made + " " + field.seen; new field.Counter(); new field.Counter(); return before + " | " + field.made + " " + field.seen; });
const twice = require("./files/stored_twice.js");
row("stored to twice by the body", () => [twice.first, twice.second, twice.third].join());
const declared = require("./files/declared_with_let.js");
row("let, class and const", () => [declared.a, declared.B.label, declared.c].join());
const cycle = require("./files/cycle_a.js");
row("a cycle", () => [cycle.early(), cycle.late, cycle.seen].join(" | "));
const zone = require("./files/dead_zone_a.js");
row("a dead zone in a cycle", () => zone.value + " " + zone.seen);
const value = require("./files/as_a_value.js");
row("keys", () => Object.keys(value).join());
row("own names", () => Object.getOwnPropertyNames(value).join());
row("a descriptor", () => { const d = Object.getOwnPropertyDescriptor(value, "x"); return [typeof d.get, d.set, d.enumerable, d.configurable, "value" in d].join(); });
row("the marker's descriptor", () => JSON.stringify(Object.getOwnPropertyDescriptor(value, "__esModule")));
row("in", () => ("x" in value) + " " + ("w" in value));
row("spread", () => JSON.stringify({ ...value }));
row("JSON", () => JSON.stringify(value));
row("a computed key", () => ["x", "default"].map(key => value[key]).join());
const outside = require("./files/stored_from_outside.js");
row("a store from sloppy code", () => { outside.x = 2; return outside.x; });
const strict = require("./files/strict_user.js");
row("a store from strict code", () => strict.store());
row("a new name from strict code", () => strict.add());
row("delete", () => { const was = delete outside.x; return was + " " + outside.x; });
row("another text for __export", () => { const m = require("./files/another_helper.js"); return m.x + " " + Object.keys(m).join(); });
row("__export is stored to", () => { const m = require("./files/helper_stored_to.js"); return m.x + " " + m.replaced; });
row("the object is read by the module", () => { const m = require("./files/holder_used.js"); return m.x + " " + m.own; });
row("the object gets one more property", () => { const m = require("./files/holder_filled.js"); return m.x + " " + m.extra; });
row("a getter that reads a member", () => { const m = require("./files/getter_of_a_member.js"); return m.x + " " + m.y; });
const uses = require("./files/uses_this.js");
row("a method that looks at this", () => uses.who());
row("the same function, taken off", () => { const who = uses.who; return who(); });
const odd = require("./files/odd_names.js");
row("odd names", () => [odd.then, odd["a-b"], odd.toString(), String(odd)].join());
row("a body that throws", () => require("./files/throws.js").before);
row("the same module again", () => { const m = require("./files/throws.js"); return m.before + " " + m.after + " " + globalThis.timesEvaluated; });
row("one more export after it", () => { const m = require("./files/more_exports.js"); return m.x + " " + m.added; });
row("exported in a branch", () => require("./files/exported_in_a_branch.js").x);
function late() { return require("./files/required_late.js").x; }
row("required by a function", late);

// FILE: files/another_helper.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: name !== "x" });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  x: () => x
});
module.exports = __toCommonJS(index_exports);
var x = 1;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  x
});

// FILE: files/as_a_value.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  x: () => x,
  y: () => y,
  default: () => z
});
module.exports = __toCommonJS(index_exports);
var x = 1;
function y() {}
var z = 3;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  x,
  y
});

// FILE: files/cycle_a.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  early: () => early,
  late: () => late,
  seen: () => seen
});
module.exports = __toCommonJS(index_exports);
function early() {
  return "early";
}
var import_b = require("./cycle_b.js");
var late = "late";
var seen = import_b.seen;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  early,
  late,
  seen
});

// FILE: files/cycle_b.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  seen: () => seen
});
module.exports = __toCommonJS(index_exports);
var import_a = require("./cycle_a.js");
var seen = [typeof import_a.early, typeof import_a.late, Object.keys(import_a).join()].join(" ");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  seen
});

// FILE: files/dead_zone_a.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  value: () => value,
  seen: () => seen
});
module.exports = __toCommonJS(index_exports);
var import_b = require("./dead_zone_b.js");
const value = 1;
var seen = import_b.seen;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  value,
  seen
});

// FILE: files/dead_zone_b.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  seen: () => seen
});
module.exports = __toCommonJS(index_exports);
var import_a = require("./dead_zone_a.js");
var seen;
try {
  seen = String(import_a.value);
} catch (error) {
  seen = error.name;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  seen
});

// FILE: files/declared_with_let.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  a: () => a,
  B: () => B,
  c: () => c
});
module.exports = __toCommonJS(index_exports);
let a = 1;
class B {
  static label = "B";
}
const c = a + 2;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  a,
  B,
  c
});

// FILE: files/exported_in_a_branch.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  x: () => x
});
if (Date.now() > 0) module.exports = __toCommonJS(index_exports);
var x = 1;

// FILE: files/getter_of_a_member.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  x: () => import_plain.limit,
  y: () => y
});
module.exports = __toCommonJS(index_exports);
var import_plain = require("./plain.js");
var y = 2;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  x,
  y
});

// FILE: files/helper_stored_to.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
__export = (target, all) => {
  target.replaced = Object.keys(all).join();
};
var index_exports = {};
__export(index_exports, {
  x: () => x
});
module.exports = __toCommonJS(index_exports);
var x = 1;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  x
});

// FILE: files/holder_filled.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  x: () => x
});
index_exports.extra = "extra";
module.exports = __toCommonJS(index_exports);
var x = 1;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  x
});

// FILE: files/holder_used.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  x: () => x,
  own: () => own
});
module.exports = __toCommonJS(index_exports);
var x = 1;
var own = Object.keys(index_exports).join();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  x,
  own
});

// FILE: files/live.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  count: () => count,
  increment: () => increment
});
module.exports = __toCommonJS(index_exports);
var count = 0;
function increment() {
  count++;
  return count;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  count,
  increment
});

// FILE: files/more_exports.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  x: () => x
});
module.exports = __toCommonJS(index_exports);
var x = 1;
module.exports.added = 2;

// FILE: files/odd_names.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  then: () => then,
  "a-b": () => dashed,
  toString: () => text
});
module.exports = __toCommonJS(index_exports);
var then = "no function";
var dashed = "a-b";
function text() {
  return "text";
}

// FILE: files/plain.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  Shape: () => Shape,
  Kind: () => Kind,
  add: () => add,
  limit: () => limit,
  table: () => table,
  default: () => index_default,
  renamed: () => original
});
module.exports = __toCommonJS(index_exports);
function add(a, b) {
  return a + b;
}
var limit = 10;
var Shape = class {
  constructor(sides) {
    this.sides = sides;
  }
  describe() {
    return "a shape with " + this.sides + " sides";
  }
};
var Kind = /* @__PURE__ */ ((Kind2) => {
  Kind2[Kind2["Round"] = 0] = "Round";
  Kind2[Kind2["Square"] = 1] = "Square";
  return Kind2;
})(Kind || {});
var table = { one: 1, two: add(1, 1) };
function original() {
  return "original";
}
var index_default = function named() {
  return "default";
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Shape,
  Kind,
  add,
  limit,
  table,
  renamed
});

// FILE: files/required_late.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  x: () => x
});
module.exports = __toCommonJS(index_exports);
var x = "required by a function";
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  x
});

// FILE: files/stored_by_a_field.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  Counter: () => Counter,
  made: () => made,
  seen: () => seen
});
module.exports = __toCommonJS(index_exports);
var made = 0;
var seen = "nothing";
var Counter = class {
  number = made = made + 1;
  constructor(label = seen = "a default") {
    this.label = label;
  }
};

// FILE: files/stored_by_a_function.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  state: () => state,
  set: () => set
});
module.exports = __toCommonJS(index_exports);
var state = "first";
function set(next) {
  state = next;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  state,
  set
});

// FILE: files/stored_from_outside.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  x: () => x
});
module.exports = __toCommonJS(index_exports);
var x = 1;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  x
});

// FILE: files/stored_twice.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  first: () => first,
  second: () => second,
  third: () => third
});
module.exports = __toCommonJS(index_exports);
var first = 1;
first = 2;
var second;
if (first === 2) second = "set in a branch";
var third;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  first,
  second,
  third
});

// FILE: files/strict_user.js
"use strict";
const outside = require("./stored_from_outside.js");
exports.store = function () {
  outside.x = 3;
  return outside.x;
};
exports.add = function () {
  outside.fresh = 4;
  return outside.fresh;
};

// FILE: files/throws.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  before: () => before,
  after: () => after
});
module.exports = __toCommonJS(index_exports);
var before = 1;
globalThis.timesEvaluated = (globalThis.timesEvaluated || 0) + 1;
if (globalThis.timesEvaluated === 1) throw new RangeError("half-way");
var after = 2;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  before,
  after
});

// FILE: files/uses_this.js
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var index_exports = {};
__export(index_exports, {
  who: () => who,
  x: () => x
});
module.exports = __toCommonJS(index_exports);
function who() {
  return this === void 0 ? "undefined" : Object.keys(this).join();
}
var x = 1;
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  who,
  x
});

// FILE: tsconfig.json
{ "compilerOptions": { "target": "esnext", "module": "preserve", "moduleDetection": "force", "moduleResolution": "bundler", "allowImportingTsExtensions": true, "types": [], "jsx": "react-jsx", "allowJs": true, "resolveJsonModule": true, "noEmit": true }, "files": [] }

// GENERATED: row late
// CHECK-LABEL: function {{*}}name="row"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] length=2 thisType={type=anything} parameters=[{type=anything}, {type=undefined|null|function flags=[IsExpected]}] results=[{type=anything}] {
// CHECK-NEXT: b0(v0: anything, v1: undefined|null|function):
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: v2 = Undefined
// CHECK-NEXT: v3 = Convert v2 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b2()
// CHECK-NEXT: b2() handler=b5():
// CHECK-NEXT: v4 = Call v1 calleeName="f"
// CHECK-NEXT: v5 = Convert v4 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b3()
// CHECK-NEXT: b3() handler=b5():
// CHECK-NEXT: Jump -> next b4()
// CHECK-NEXT: b4():
// CHECK-NEXT: Jump -> next b6(v5)
// CHECK-NEXT: b5() role=CatchHandler:
// CHECK-NEXT: v6 = CatchValue
// CHECK-NEXT: v7 = String string="threw "
// CHECK-NEXT: v8 = PropGet v6 key="name"
// CHECK-NEXT: v9 = Add v7, v8
// CHECK-NEXT: v10 = Convert v9 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b6(v10)
// CHECK-NEXT: b6(v11):
// CHECK-NEXT: v12 = Builtin builtin=GlobalThis
// CHECK-NEXT: v13 = PropGet v12 key="console" [isFreeName]
// CHECK-NEXT: v14 = Convert v13 declared={type=builtin(Console) flags=[IsExpected]}
// CHECK-NEXT: v15 = PropGet v14 key="log"
// CHECK-NEXT: v16 = Convert v15 declared={type=builtin(ConsoleLog) flags=[IsExpected]}
// CHECK-NEXT: v17 = String string=": "
// CHECK-NEXT: v18 = Add v0, v17
// CHECK-NEXT: v19 = TypeTest v11 testedType=function
// CHECK-NEXT: Branch v19 -> taken b7(| 0), notTaken b9(| 0)
// CHECK-NEXT: b7(v20):
// CHECK-NEXT: Jump -> next b8()
// CHECK-NEXT: b8():
// CHECK-NEXT: v21 = String string="F"
// CHECK-NEXT: Jump -> next b11(v21)
// CHECK-NEXT: b9(v22):
// CHECK-NEXT: Jump -> next b10()
// CHECK-NEXT: b10():
// CHECK-NEXT: v23 = Builtin builtin=String
// CHECK-NEXT: v24 = Call v23, -, v22 calleeName="String"
// CHECK-NEXT: v25 = Convert v24 declared={type=undefined|null|string flags=[IsExpected]}
// CHECK-NEXT: Jump -> next b11(v25)
// CHECK-NEXT: b11(v26):
// CHECK-NEXT: v27 = Add v18, v26
// CHECK-NEXT: v28 = Call v16, v14, v27 calleeKey="log" calleeName="console.log"
// CHECK-NEXT: v29 = Undefined
// CHECK-NEXT: Return v29
// CHECK-NEXT: }
// CHECK-LABEL: function {{*}}name="late"
// CHECK: module=[[m_0]] position={{*}} text={{*}} flags=[IsSloppy, HasExplicitName] thisType={type=anything} results=[{type=anything}] functionTypes={{*}}[[f_1]]] {
// CHECK-NEXT: b0():
// CHECK-NEXT: Jump -> next b1()
// CHECK-NEXT: b1():
// CHECK-NEXT: EvaluateModule module=[[m_2]] referrer=[[m_0]] [isCallOfRequire]
// CHECK-NEXT: v1 = GetModuleVariable variable=[[g_3]]
// CHECK-NEXT: v2 = Convert v1 declared={type=undefined|null|number|string|symbol|bigint|[[L_4]] flags=[IsExpected]}
// CHECK-NEXT: v3 = PropGet v2 key="x"
// CHECK-NEXT: Return v3
// CHECK-NEXT: }
