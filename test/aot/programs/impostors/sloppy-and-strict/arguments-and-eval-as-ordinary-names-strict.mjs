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
  aVarNamedArguments: "function () { var arguments = [1, 2, 3]; return [arguments.length, Array.isArray(arguments)]; }",
  aVarWithoutAValue: "function () { var arguments; return [arguments.length, Array.isArray(arguments)]; }",
  aParameterNamedArguments: "function (arguments) { return [typeof arguments, arguments.length]; }",
  aStoreToArguments: "function (a) { arguments = \"a text\"; return [arguments.length, a]; }",
  aStoreThenAnElement: "function (a) { arguments = [10]; arguments[0] = \"stored\"; return a; }",
  incremented: "function () { arguments++; return arguments; }",
  aFunctionNamedArguments: "function () { function arguments() {} return typeof arguments; }",
  aCatchParameter: "function () { try { throw \"thrown\"; } catch (arguments) { return arguments; } }",
  aVarNamedEval: "function () { var eval = function (text) { return \"not evaluated: \" + text; }; return eval(\"1 + 1\"); }",
  aParameterNamedEval: "function (eval) { return typeof eval; }",
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
  attempt(label + "(1, 2)", callee.bind(null, 1, 2));
  attempt(label + "('abc')", callee.bind(null, "abc"));
  attempt(label + "()", callee);
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
