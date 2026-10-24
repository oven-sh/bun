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

function upper(text) {
  arguments[0] = 5;
  return text.toUpperCase();
}
function code(text) {
  arguments[0] = ["x"];
  return text.charCodeAt(0);
}
function glued(text) {
  arguments[0] = 1;
  return text + 1;
}
function size(text) {
  arguments[0] = [1, 2, 3, 4, 5];
  return text.length;
}
function sliced(text) {
  arguments[0] = [1, 2, 3];
  return text.slice(1);
}
function found(text) {
  arguments[0] = ["b", "a"];
  return text.indexOf("a");
}
function afterTypeof(text) {
  if (typeof text !== "string") return "no text";
  arguments[0] = { length: "long" };
  return text.length;
}
function inATemplate(text) {
  arguments[0] = Symbol("no text");
  return `<${text}>`;
}
function compared(text) {
  arguments[0] = 10;
  return [text < "9", text === "abc", text == "10"];
}
function asAKey(text) {
  arguments[0] = 1;
  return { abc: "by the text", 1: "by the number" }[text];
}
function boxed(text) {
  arguments[0] = new String("boxed");
  return [typeof text, text.length, text === "boxed"];
}
function sometimes(text, change) {
  if (change) arguments[0] = null;
  return text.length;
}

var sum = 0;
for (var i = 0; i < 2000; i++) sum += sometimes("abc", false);
console.log("sum", sum);
var uses = { upper, code, glued, size, sliced, found, afterTypeof, inATemplate, compared, asAKey, boxed };
for (var name in uses) attempt(name, uses[name].bind(null, "abc"));
attempt("sometimes, changed", () => sometimes("abc", true));
attempt("sometimes, unchanged", () => sometimes("abc", false));

export {};
