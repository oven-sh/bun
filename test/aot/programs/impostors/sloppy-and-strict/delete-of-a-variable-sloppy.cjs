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

globalThis.removable = "a member of the global object";

var written = {
  local: function () {
    var local = 1;
    return [delete local, typeof local];
  },
  parameter: function (parameter) {
    return [delete parameter, typeof parameter];
  },
  parameterThenUsed: function (parameter) {
    delete parameter;
    return parameter + 1;
  },
  aLet: function () {
    let local = 1;
    return [delete local, typeof local];
  },
  aFunction: function () {
    function local() {}
    return [delete local, typeof local];
  },
  operands: function () {
    return [delete arguments, typeof arguments];
  },
  absent: function () {
    return delete neverDeclaredAnywhere;
  },
  memberOfTheGlobalObject: function () {
    globalThis.removable = "made again";
    return [delete removable, typeof removable];
  },
  madeByAnAssignment: function () {
    madeHere = 1;
    return [delete madeHere, typeof madeHere];
  },
  declaredByEval: function () {
    eval("var declared = 1");
    return [delete declared, typeof declared];
  },
  declaredByEvalOverAParameter: function (parameter) {
    eval("var parameter = 'declared again'");
    return [delete parameter, parameter];
  },
  catchParameter: function () {
    try {
      throw 1;
    } catch (caught) {
      return [delete caught, typeof caught];
    }
  },
  aBuiltIn: function () {
    return [delete undefined, delete NaN, delete Infinity];
  },
  inParentheses: function () {
    var local = 1;
    return [delete (local), typeof local];
  },
};

var texts = {
  local: "function () { var local = 1; return [delete local, typeof local]; }",
  parameter: "function (parameter) { return [delete parameter, typeof parameter]; }",
  parameterThenUsed: "function (parameter) { delete parameter; return parameter + 1; }",
  aLet: "function () { let local = 1; return [delete local, typeof local]; }",
  aFunction: "function () { function local() {} return [delete local, typeof local]; }",
  operands: "function () { return [delete arguments, typeof arguments]; }",
  absent: "function () { return delete neverDeclaredAnywhere; }",
  memberOfTheGlobalObject: "function () { globalThis.removable = \"made again\"; return [delete removable, typeof removable]; }",
  madeByAnAssignment: "function () { madeHere = 1; return [delete madeHere, typeof madeHere]; }",
  declaredByEval: "function () { eval(\"var declared = 1\"); return [delete declared, typeof declared]; }",
  declaredByEvalOverAParameter: "function (parameter) { eval(\"var parameter = 'declared again'\"); return [delete parameter, parameter]; }",
  catchParameter: "function () { try { throw 1; } catch (caught) { return [delete caught, typeof caught]; } }",
  aBuiltIn: "function () { return [delete undefined, delete NaN, delete Infinity]; }",
  inParentheses: "function () { var local = 1; return [delete (local), typeof local]; }",
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
  attempt(label, callee.bind(null, 1));
  attempt(label + " once more", callee.bind(null, 1));
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
