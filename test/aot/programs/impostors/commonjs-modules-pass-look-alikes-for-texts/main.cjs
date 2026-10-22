function show(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return String(value) + "n";
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (ArrayBuffer.isView(value)) return value.constructor.name + "<" + Array.prototype.join.call(value, " ") + ">";
  let text;
  try {
    text = String.prototype.valueOf.call(value);
  } catch {
    const parts = [];
    for (const key of Reflect.ownKeys(value)) parts.push(String(key) + ": " + show(value[key]));
    return "{" + parts.join(", ") + "}";
  }
  return "String object " + JSON.stringify(text);
}

function attempt(label, run) {
  let line;
  try {
    line = show(run());
  } catch (error) {
    line = "threw " + error.constructor.name;
  }
  console.log(label + " -> " + line);
}

function make(text) {
  return (0, eval)("(" + text + ")");
}

var tools = require("./text-tools.cjs");
var runHonestCallers = require("./honest-callers.cjs");
var values = require("./look-" + make("'alikes'") + ".cjs");

console.log("honest callers", runHonestCallers(2000));

Object.keys(values).forEach(function (name) {
  attempt("hash of " + name, function () { return tools.hash(values[name]); });
  attempt("capitalize " + name, function () { return tools.capitalize(values[name]); });
  attempt("count " + name, function () {
    var counts = tools.count(tools.count({}, values[name]), values[name]);
    return [Reflect.ownKeys(counts).map(String), Object.getPrototypeOf(counts) === Object.prototype];
  });
  attempt("is a name " + name, function () { return tools.isName(values[name]); });
  attempt("pad " + name, function () { return tools.pad(values[name], 7); });
});

tools.hash = function () { return "replaced from outside"; };
attempt("an export is replaced from outside", function () { return [require("./text-tools.cjs").hash("hello"), typeof runHonestCallers(1)]; });
attempt("the module object is used as a table", function () { return [Object.keys(tools), "pad" in tools, tools[make("'p' + 'ad'")]("x", 2)]; });
