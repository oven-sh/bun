// `arguments` is changed by a deed that leaves it with the function alone, and is read behind it: at a constant index, at one that arrives, in front of and behind the last parameter and the last argument.
const above = { 0: "above 0", 1: "above 1", 2: "above 2", 3: "above 3", 9: "above 9", length: "above length" };
const show = value => (value === undefined ? "undefined" : String(value));
const rows = [];
function report(name, ...values) { rows.push(name + ": " + values.map(show).join(" | ")); }

function strictMoved(a) { "use strict"; Object.setPrototypeOf(arguments, above); return [arguments[0], arguments[1], arguments[2], arguments[3], arguments[9], arguments.length]; }
function sloppyMoved(a) { Object.setPrototypeOf(arguments, above); return [arguments[0], arguments[1], arguments[2], arguments[3], arguments[9], arguments.length]; }
function strictMovedByKey(a, key) { "use strict"; Object.setPrototypeOf(arguments, above); return arguments[key]; }
function sloppyMovedByKey(a, key) { Object.setPrototypeOf(arguments, above); return arguments[key]; }
function strictProto(a) { "use strict"; arguments.__proto__ = above; return [arguments[0], arguments[1], arguments[2], arguments[3], arguments[9]]; }
function sloppyProto(a) { arguments.__proto__ = above; return [arguments[0], arguments[1], arguments[2], arguments[3], arguments[9]]; }
function reflectMoved(a) { "use strict"; Reflect.setPrototypeOf(arguments, above); return [arguments[1], arguments[2], arguments[3], arguments[9]]; }
function strictDeleted(a, b) { "use strict"; delete arguments[0]; delete arguments[2]; return [arguments[0], arguments[1], arguments[2], arguments[3], arguments.length, a]; }
function sloppyDeleted(a, b) { delete arguments[0]; delete arguments[2]; a = "stored"; return [arguments[0], arguments[1], arguments[2], arguments[3], arguments.length, a]; }
function deletedThenMoved(a) { "use strict"; delete arguments[1]; Object.setPrototypeOf(arguments, above); return [arguments[0], arguments[1], arguments[2]]; }
function strictLength(a) { "use strict"; arguments.length = 0; return [arguments.length, arguments[0], arguments[1], arguments[2], [...arguments].length, Array.prototype.slice.call(arguments).length]; }
function sloppyLength(a) { arguments.length = 1; return [arguments.length, arguments[0], arguments[1], arguments[2], [...arguments].length, Array.prototype.slice.call(arguments).length]; }
function longerLength(a) { "use strict"; arguments.length = 5; return [arguments.length, arguments[4], [...arguments].join(), Array.prototype.slice.call(arguments).length]; }
function strictDefined(a) { "use strict"; Object.defineProperty(arguments, 0, { value: "defined 0" }); Object.defineProperty(arguments, 2, { get() { return "getter 2"; } }); Object.defineProperty(arguments, 7, { value: "defined 7" }); return [arguments[0], arguments[1], arguments[2], arguments[7], arguments.length, a]; }
function sloppyDefined(a) { Object.defineProperty(arguments, 0, { value: "defined 0" }); Object.defineProperty(arguments, 2, { get() { return "getter 2"; } }); return [arguments[0], arguments[1], arguments[2], arguments.length, a]; }
function storedBehind(a) { "use strict"; arguments[5] = "stored 5"; arguments[1] = "stored 1"; return [arguments[0], arguments[1], arguments[2], arguments[5], arguments.length]; }
function frozen(a) { "use strict"; Object.freeze(arguments); try { arguments[1] = "x"; } catch (error) { return [error.constructor.name, arguments[1], arguments[2]]; } return ["no error", arguments[1]]; }
function forwarded(a) { "use strict"; Object.setPrototypeOf(arguments, above); arguments.length = 4; return taker.apply(null, arguments); }
function taker(...all) { return all.map(show).join(","); }
function spreadMoved(a) { "use strict"; Object.setPrototypeOf(arguments, Array.prototype); return [arguments.length, typeof arguments.map, arguments.map(x => x + "!").join()]; }

for (let turn = 0; turn < 3; turn++) {
  rows.length = 0;
  report("strictMoved", ...strictMoved("a", "b", "c"));
  report("strictMoved one", ...strictMoved("a"));
  report("strictMoved none", ...strictMoved());
  report("sloppyMoved", ...sloppyMoved("a", "b", "c"));
  report("sloppyMoved none", ...sloppyMoved());
  for (const key of [0, 1, 2, 3, 9, "length", -1, 1.5]) report("by key " + key, strictMovedByKey("a", key), sloppyMovedByKey("a", key), strictMovedByKey("a", key, "c", "d"));
  report("strictProto", ...strictProto("a", "b"));
  report("sloppyProto", ...sloppyProto("a", "b"));
  report("reflectMoved", ...reflectMoved("a", "b"));
  report("strictDeleted", ...strictDeleted("a", "b", "c", "d"));
  report("sloppyDeleted", ...sloppyDeleted("a", "b", "c", "d"));
  report("deletedThenMoved", ...deletedThenMoved("a", "b", "c"));
  report("strictLength", ...strictLength("a", "b", "c"));
  report("sloppyLength", ...sloppyLength("a", "b", "c"));
  report("longerLength", ...longerLength("a", "b"));
  report("strictDefined", ...strictDefined("a", "b", "c"));
  report("sloppyDefined", ...sloppyDefined("a", "b", "c"));
  report("storedBehind", ...storedBehind("a", "b", "c"));
  report("frozen", ...frozen("a", "b", "c"));
  report("forwarded", forwarded("a", "b"));
  report("spreadMoved", ...spreadMoved("a", "b"));
}
console.log(rows.join("\n"));
