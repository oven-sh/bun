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
  aLabelledFunction: function () {
    label: function labelled() {
      return "labelled";
    }
    return labelled();
  },
  aFunctionAfterIf: function (value) {
    if (value) function made() {
      return "made";
    }
    return typeof made;
  },
  aFunctionAfterElse: function (value) {
    if (value) ;
    else function made() {
      return "made";
    }
    return typeof made;
  },
  calledAfterIf: function (value) {
    if (value) function made() {
      return "made";
    }
    return made();
  },
  inTheBlockOfWith: function (value) {
    var object = { x: value };
    with (object) {
      function x() {}
    }
    return [typeof x, typeof object.x];
  },
  aLabelInABlock: function () {
    {
      label: function labelled() {}
    }
    return typeof labelled;
  },
};

var texts = {
  aLabelledFunction: "function () { label: function labelled() { return \"labelled\"; } return labelled(); }",
  aFunctionAfterIf: "function (value) { if (value) function made() { return \"made\"; } return typeof made; }",
  aFunctionAfterElse: "function (value) { if (value) ; else function made() { return \"made\"; } return typeof made; }",
  calledAfterIf: "function (value) { if (value) function made() { return \"made\"; } return made(); }",
  inTheBlockOfWith: "function (value) { var object = { x: value }; with (object) { function x() {} } return [typeof x, typeof object.x]; }",
  aLabelInABlock: "function () { { label: function labelled() {} } return typeof labelled; }",
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
  attempt(label + "(1)", callee.bind(null, 1));
  attempt(label + "(0)", callee.bind(null, 0));
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
