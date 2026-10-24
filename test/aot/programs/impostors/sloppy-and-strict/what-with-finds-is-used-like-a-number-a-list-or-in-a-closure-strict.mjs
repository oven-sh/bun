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

globalThis.x = "the global x";
globalThis.size = "the global size";

var texts = {
  plusOne: "function (object) { var x = 1; with (object) { return x + 1; } }",
  length: "function (object) { var x = [1, 2, 3]; with (object) { return x.length; } }",
  kind: "function (object) { var x = 1; with (object) { return typeof x; } }",
  inALoop: "function (object) { var x = 1; var sum = 0; with (object) { for (var i = 0; i < 3; i++) sum += x; } return sum; }",
  inAClosure: "function (object) { var x = \"the local x\"; with (object) { return (function () { return x; })(); } }",
};

var ways = {
  "direct eval": function (text) {
    return eval("(" + text + ")");
  },
  "indirect eval": function (text) {
    return (0, eval)("(" + text + ")");
  },
  "new Function": function (text) {
    return new Function("return (" + text + ")")();
  },
};

var reads = 0;
var objects = {
  empty: () => ({}),
  withX: () => ({ x: "the member x" }),
  withANumber: () => ({ x: 41 }),
  withAText: () => ({ x: "text" }),
  withUndefined: () => ({ x: undefined }),
  inherited: () => Object.create({ x: "the inherited x" }),
  getter: () => ({
    get x() {
      return "read " + ++reads;
    },
  }),
  withSize: () => ({ size: "the member size" }),
  map: () => new Map([["x", 1]]),
  list: () => [1, 2],
  text: () => "text",
  number: () => 5,
  noPrototype: () => Object.assign(Object.create(null), { x: "the member of an object without a prototype" }),
  none: () => null,
  nothing: () => undefined,
};
function drive(label, callee) {
  for (var i = 0; i < 300; i++) callee({}, "the operand x");
  for (var name in objects) {
    reads = 0;
    attempt(label + "(" + name + ")", callee.bind(null, objects[name](), "the operand x"));
  }
}

Object.keys(ways).forEach(function (way) {
  Object.keys(texts).forEach(function (name) {
    var made;
    try {
      made = ways[way](texts[name]);
    } catch (error) {
      console.log(way + " " + name, "is refused:", error.constructor.name);
      return;
    }
    drive(way + " " + name, made, name);
  });
});

export {};
