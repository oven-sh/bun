const util = require("node:util");

function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

function Collection() {
  this.length = 0;
  for (var i = 0; i < arguments.length; i++) this.push(arguments[i]);
}
Collection.prototype = Object.create(Array.prototype);
Collection.prototype.constructor = Collection;
Collection.prototype.first = function () {
  return this[0];
};

function Inherited() {
  Array.call(this);
  this.push.apply(this, arguments);
}
util.inherits(Inherited, Array);

function OverAnArray() {
  this.push.apply(this, arguments);
}
OverAnArray.prototype = [];
OverAnArray.prototype.constructor = OverAnArray;

function Query() {
  var self = this instanceof Query ? this : Object.create(Query.prototype);
  self.length = 0;
  Array.prototype.push.apply(self, arguments);
  return self;
}
Query.prototype = {
  constructor: Query,
  length: 0,
  push: Array.prototype.push,
  sort: Array.prototype.sort,
  splice: Array.prototype.splice,
  each: function (callback) {
    for (var i = 0; i < this.length; i++) callback.call(this[i], i, this[i]);
    return this;
  },
  map: function (callback) {
    return Query.apply(null, Array.prototype.map.call(this, callback));
  },
  toArray: function () {
    return Array.prototype.slice.call(this);
  },
};

function Wrapped() {
  var list = Array.prototype.slice.call(arguments);
  Object.setPrototypeOf(list, Wrapped.prototype);
  return list;
}
Wrapped.prototype = Object.create(Array.prototype);
Wrapped.prototype.constructor = Wrapped;
Wrapped.prototype.push = function () {
  return "Wrapped's push";
};

var makers = {
  "an array": function () { return [3, 1, 2]; },
  "Object.create(Array.prototype)": function () { return new Collection(3, 1, 2); },
  "util.inherits": function () { return new Inherited(3, 1, 2); },
  "a prototype that is an array": function () { return new OverAnArray(3, 1, 2); },
  "borrowed methods": function () { return new Query(3, 1, 2); },
  "borrowed methods without new": function () { return Query(3, 1, 2); },
  "a real array relinked": function () { return new Wrapped(3, 1, 2); },
};

var uses = {
  checks: function (list) { return [Array.isArray(list), list instanceof Array, list.length, Object.keys(list).join(), Object.prototype.toString.call(list)]; },
  sum: function (list) {
    var total = 0;
    for (var i = 0; i < list.length; i++) total += list[i];
    return total;
  },
  push: function (list) { return [list.push(9), list.length, list[3]]; },
  append: function (list) {
    list[list.length] = 9;
    return [list.length, list[3]];
  },
  truncate: function (list) {
    list.length = 1;
    return [list.length, list[1], Object.keys(list).join()];
  },
  sort: function (list) { return Array.prototype.slice.call(list.sort()); },
  map: function (list) {
    var result = list.map(function (value) { return value * 2; });
    return [Array.isArray(result), result.constructor.name, Array.prototype.slice.call(result)];
  },
  slice: function (list) {
    var result = Array.prototype.slice.call(list, 1);
    return [Array.isArray(result), result.constructor.name, result];
  },
  ownSlice: function (list) {
    var result = list.slice(1);
    return [Array.isArray(result), result.constructor.name, result.length];
  },
  concat: function (list) { return [0].concat(list).length; },
  ownConcat: function (list) { return list.concat([9]).length; },
  walk: function (list) {
    var seen = [];
    for (var value of list) seen.push(value);
    return seen;
  },
  spread: function (list) { return Math.max.apply(Math, list) + Math.max(...list); },
  json: function (list) { return JSON.stringify(list); },
  forIn: function (list) {
    var seen = [];
    for (var key in list) seen.push(key);
    return seen.join();
  },
  join: function (list) { return Array.prototype.join.call(list, "-") + "|" + String(list); },
  splice: function (list) { return [Array.prototype.slice.call(list.splice(0, 1)), list.length, list[0]]; },
};

for (var use in uses) for (var i = 0; i < 1000; i++) uses[use]([3, 1, 2]);

for (var name in makers) {
  for (var use in uses) {
    (function (name, use) {
      attempt(name + ", " + use, function () { return uses[use](makers[name]()); });
    })(name, use);
  }
}

attempt("each", function () {
  var seen = [];
  new Query("a", "b").each(function (index, value) { seen.push(index, value, typeof this); });
  return seen;
});
attempt("toArray", function () { return new Query("a", "b").toArray(); });
attempt("first", function () { return new Collection("a", "b").first(); });
attempt("the array that is a prototype stays empty", function () { new OverAnArray(1, 2); return [OverAnArray.prototype.length, Object.keys(OverAnArray.prototype).join()]; });
