console.log("strict:", (function () {
  return this === undefined;
})());

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (value === globalThis) return "the global object";
  if (Array.isArray(value)) return "[" + Array.from(value, (item, index) => (index in value ? show(item) : "hole")).join(", ") + "]";
  var tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Arguments") return "arguments" + show(Array.from(value));
  if (/^(Number|String|Boolean|BigInt|Symbol)$/.test(tag)) return "boxed " + show(Object.getPrototypeOf(value).valueOf.call(value));
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

function size(list) {
  arguments[0] = "a text";
  return list.length;
}
function pushed(list) {
  arguments[0] = {
    push: function () {
      return "own push";
    },
  };
  return list.push(1);
}
function first(list) {
  arguments[0] = { 0: "first of an object" };
  return list[0];
}
function walked(list) {
  arguments[0] = new Set([7, 8]);
  var seen = [];
  for (var item of list) seen.push(item);
  return seen;
}
function mapped(list) {
  arguments[0] = null;
  return list.map(function (item) {
    return item;
  });
}
function sometimes(list, change) {
  if (change) arguments[0] = "abc";
  return list.length + list[0];
}
function afterACheck(list) {
  if (!Array.isArray(list)) return "no list";
  arguments[0] = "abc";
  return list.concat([1]);
}
function midLoop(list) {
  var sum = 0;
  for (var i = 0; i < list.length; i++) {
    sum += list[i];
    if (i === 0) arguments[0] = [10, 20, 30, 40];
  }
  return sum;
}
function midForOf(list) {
  var sum = 0;
  for (var item of list) {
    sum += item;
    arguments[0] = [100];
  }
  return [sum, list.length];
}
function unpacked(list) {
  arguments[0] = "xy";
  var [a, b] = list;
  return [a, b];
}
function spread(list) {
  arguments[0] = "xy";
  return [...list];
}
function stored(list) {
  arguments[0] = Object.freeze([0]);
  list[0] = 5;
  return list[0];
}

var sum = 0;
for (var i = 0; i < 2000; i++) sum += sometimes([i, 2], false);
console.log("sum", sum);
var uses = { size, pushed, first, walked, mapped, afterACheck, midLoop, midForOf, unpacked, spread, stored };
for (var name in uses) {
  var given = [1, 2, 3];
  attempt(name, uses[name].bind(null, given));
  attempt(name + " leaves", () => given);
}
attempt("sometimes, changed", () => sometimes([1, 2], true));
attempt("sometimes, unchanged", () => sometimes([1, 2], false));

export {};
