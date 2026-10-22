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
  oneDigit: "function () { return [\"\\7\".length, \"\\7\".charCodeAt(0), \"\\1a\"]; }",
  twoDigits: "function () { return [\"\\12\".length, \"\\12\".charCodeAt(0), \"\\77\"]; }",
  zeroThenADigit: "function () { return [\"\\08\".length, \"\\01\".length, \"\\00\".length]; }",
  zeroAlone: "function () { return [\"\\0\".length, \"\\0a\".length]; }",
  asAKey: "function () { return Object.keys({ \"\\61\": 1, \"\\60\": 2 }); }",
  afterUseStrict: "function () { \"\\7\"; \"use strict\"; return this === undefined; }",
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
  attempt(label, callee);
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
