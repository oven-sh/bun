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

var written = {
  let: function (value) {
    var let = value;
    return let + 1;
  },
  static: function (value) {
    var static = value;
    return static.length;
  },
  yield: function (value) {
    var yield = value;
    return yield * 2;
  },
  several: function (value) {
    var implements = value, interface = value, package = value, private = value, protected = value, public = value;
    return [implements, interface, package, private, protected, public].length;
  },
  asParameters: function (let, static, yield) {
    return [let, static, yield];
  },
  asAFunctionName: function () {
    function static() {
      return "called";
    }
    return static();
  },
  asALabel: function () {
    yield: for (;;) break yield;
    return "left the loop";
  },
  letWithAnIndex: function (value) {
    var let = [value];
    return [let[0], let.length];
  },
};

var texts = {
  let: "function (value) { var let = value; return let + 1; }",
  static: "function (value) { var static = value; return static.length; }",
  yield: "function (value) { var yield = value; return yield * 2; }",
  several: "function (value) { var implements = value, interface = value, package = value, private = value, protected = value, public = value; return [implements, interface, package, private, protected, public].length; }",
  asParameters: "function (let, static, yield) { return [let, static, yield]; }",
  asAFunctionName: "function () { function static() { return \"called\"; } return static(); }",
  asALabel: "function () { yield: for (;;) break yield; return \"left the loop\"; }",
  letWithAnIndex: "function (value) { var let = [value]; return [let[0], let.length]; }",
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
  attempt(label + "(1)", callee.bind(null, 1, 2, 3));
  attempt(label + "('ab')", callee.bind(null, "ab"));
  attempt(label + "()", callee);
}

Object.keys(written).forEach(function (name) {
  drive("written " + name, written[name], name);
});
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
