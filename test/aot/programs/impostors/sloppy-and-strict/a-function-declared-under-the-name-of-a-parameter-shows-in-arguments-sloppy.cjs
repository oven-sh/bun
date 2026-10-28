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

function declared(a) {
  function a() {}
  return [typeof a, typeof arguments[0], arguments[0] === a];
}
function declaredSecond(a, b) {
  function b() {}
  return [typeof a, typeof arguments[0], typeof b, typeof arguments[1]];
}
function storedAfterwards(a) {
  function a() {}
  arguments[0] = "stored";
  return [typeof a, typeof arguments[0]];
}
function assignedAfterwards(a) {
  function a() {}
  a = "assigned";
  return [typeof a, typeof arguments[0]];
}
attempt("declared(1)", () => declared(1));
attempt("declared()", () => declared());
attempt("declaredSecond(1, 2)", () => declaredSecond(1, 2));
attempt("declaredSecond(1)", () => declaredSecond(1));
attempt("storedAfterwards(1)", () => storedAfterwards(1));
attempt("assignedAfterwards(1)", () => assignedAfterwards(1));
