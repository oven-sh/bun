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

var texts = {
  lastWins: "function (a, a) { return a; }",
  plusOne: "function (a, a) { return a + 1; }",
  size: "function (list, list) { return list.length; }",
  operands: "function (a, a) { return [arguments[0], arguments[1], arguments.length]; }",
  storeToTheFirstOperand: "function (a, a) { arguments[0] = \"stored\"; return a; }",
  storeToTheSecondOperand: "function (a, a) { arguments[1] = \"stored\"; return a; }",
  storeToTheName: "function (a, a) { a = \"assigned\"; return [arguments[0], arguments[1]]; }",
  three: "function (a, b, a) { return [a, b]; }",
  declaredLength: "function (a, a, a) { return arguments.callee.length; }",
  withAVar: "function (a, a) { var a; return a; }",
  withAnInnerFunction: "function (a, a) { function a() {} return typeof a; }",
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

function drive(label, callee) {
  for (var i = 0; i < 300; i++) callee(i, i);
  attempt(label + "(1, 2)", callee.bind(null, 1, 2));
  attempt(label + "(1)", callee.bind(null, 1));
  attempt(label + "([1], 'ab')", callee.bind(null, [1], "ab"));
  attempt(label + "(1, 2, 3)", callee.bind(null, 1, 2, 3));
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
