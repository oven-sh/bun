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

function fill(object, freezeAt, close) {
  var done = 0;
  for (var i = 0; i < 2000; i++) {
    object.count = i;
    done++;
    if (i === freezeAt) close(object);
  }
  return done;
}
function grow(list, freezeAt, close) {
  var done = 0;
  for (var i = 0; i < 2000; i++) {
    list[i] = i;
    done++;
    if (i === freezeAt) close(list);
  }
  return done;
}
function push(list, freezeAt, close) {
  var done = 0;
  for (var i = 0; i < 2000; i++) {
    list.push(i);
    done++;
    if (i === freezeAt) close(list);
  }
  return done;
}
function extend(object, freezeAt, close) {
  var done = 0;
  for (var i = 0; i < 50; i++) {
    object["key" + i] = i;
    done++;
    if (i === freezeAt) close(object);
  }
  return done;
}
var closers = {
  nothing: function () {},
  freeze: Object.freeze,
  seal: Object.seal,
  preventExtensions: Object.preventExtensions,
  fixCount: function (object) {
    Object.defineProperty(object, "count", { writable: false });
  },
  getterForCount: function (object) {
    Object.defineProperty(object, "count", {
      get: function () {
        return "from a getter";
      },
    });
  },
  fixLength: function (object) {
    if (Array.isArray(object)) Object.defineProperty(object, "length", { writable: false });
  },
};
for (var name in closers) {
  var object = { count: -1 };
  attempt("fill, " + name, fill.bind(null, object, 1000, closers[name]));
  attempt("fill, " + name + " leaves", () => object.count);
  var list = [];
  attempt("grow, " + name, grow.bind(null, list, 1000, closers[name]));
  attempt("grow, " + name + " leaves", () => [list.length, list[1000], list[1001]]);
  var pushed = [];
  attempt("push, " + name, push.bind(null, pushed, 1000, closers[name]));
  attempt("push, " + name + " leaves", () => [pushed.length, pushed[1000], pushed[1001]]);
  var extended = {};
  attempt("extend, " + name, extend.bind(null, extended, 20, closers[name]));
  attempt("extend, " + name + " leaves", () => Object.keys(extended).length);
}

export {};
