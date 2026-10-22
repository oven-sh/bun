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
  literal: function () {
    return 010;
  },
  sum: function (n) {
    return n + 010 + 0777;
  },
  notOctalAfterAll: function () {
    return [08, 09, 019, 08.5];
  },
  asAnIndex: function () {
    return [0, 1, 2, 3, 4, 5, 6, 7, "the ninth element"][010];
  },
  asAKey: function () {
    return Object.keys({ 010: "a", 0x10: "b", 0o11: "c" });
  },
  member: function () {
    return 010.toString();
  },
  bits: function (n) {
    return [n | 017, n << 01, 037777777777 | 0];
  },
  negative: function () {
    return [-010, -00, 1 / -00];
  },
  escape: function () {
    return ["\101", "\377".charCodeAt(0), "\400".length, "\101\102"];
  },
  escapeInAKey: function () {
    return { "\101": 1 }.A;
  },
  eightAndNine: function () {
    return ["\8", "\9"];
  },
  compared: function (n) {
    return [n === 010, n < 011, "8" == 010, parseInt("010"), Number("010")];
  },
};

var texts = {
  literal: "function () { return 010; }",
  sum: "function (n) { return n + 010 + 0777; }",
  notOctalAfterAll: "function () { return [08, 09, 019, 08.5]; }",
  asAnIndex: "function () { return [0, 1, 2, 3, 4, 5, 6, 7, \"the ninth element\"][010]; }",
  asAKey: "function () { return Object.keys({ 010: \"a\", 0x10: \"b\", 0o11: \"c\" }); }",
  member: "function () { return 010.toString(); }",
  bits: "function (n) { return [n | 017, n << 01, 037777777777 | 0]; }",
  negative: "function () { return [-010, -00, 1 / -00]; }",
  escape: "function () { return [\"\\101\", \"\\377\".charCodeAt(0), \"\\400\".length, \"\\101\\102\"]; }",
  escapeInAKey: "function () { return { \"\\101\": 1 }.A; }",
  eightAndNine: "function () { return [\"\\8\", \"\\9\"]; }",
  compared: "function (n) { return [n === 010, n < 011, \"8\" == 010, parseInt(\"010\"), Number(\"010\")]; }",
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
  attempt(label, callee.bind(null, 8));
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
