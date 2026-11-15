// lodash's isObject: the string in the variable is only compared, so each comparison is a test of the value's type.
// COUNT: operation:operationAOTTypeOf <= 2000
function isObject(value) {
  var type = typeof value;
  return value != null && (type == "object" || type == "function");
}
function kind(value) {
  var type = typeof value;
  if (type != "object") return type == "string" ? 1 : type === "number" ? 2 : type !== "function" ? 3 : 4;
  return "object" == type && value ? 5 : 6;
}
function nested(value, deep) {
  if (deep) {
    var type = typeof value;
    for (let k = 0; k < 2; k++) {
      var inner = typeof value;
      if (inner === "object" && k) return type === inner ? "object" : "never";
    }
    while (deep--) if (type == "function") return "function";
    return type === "undefined" ? "nothing" : "other";
  }
  return "shallow";
}
function switched(value) {
  var type = typeof value;
  switch (type) {
    case "object":
      return value === null ? "null" : "object";
    case "symbol":
    case "bigint":
      return "rare";
    default:
      return type < "o" ? "before" : "after";
  }
}
const values = [1, "a", null, undefined, {}, [], () => 1, 2n, Symbol(), true, NaN, new Map(), class {}, new Proxy({}, {}), new Proxy(() => 1, {}), Object.create(null), -0, ""];
const called = values.map(value => [isObject(value), kind(value), nested(value, 1), nested(value, 0), switched(value)].join());
for (let k = 0; k < 3000; k++) isObject(values[k % values.length]), kind(values[k % values.length]);
console.log(called.join("\n"));

// Where the variable has another value, or none yet.
function readBefore(value) {
  const before = type == "object";
  var type = typeof value;
  return before + "," + (type == "object");
}
function sometimes(value, set) {
  if (set) var type = typeof value;
  return type == "object" ? "object" : type === undefined ? "unset" : "set";
}
function inLoop(value) {
  const found = [];
  for (let k = 0; k < 2; k++) {
    found.push(type === "object");
    var type = typeof value;
    found.push(type === "object");
  }
  return found.join();
}
function changed(value) {
  var type = typeof value;
  if (type == "object") type = "list";
  return type == "object" || type == "list";
}
function changedValue(value) {
  var type = typeof value;
  value = 1;
  return type == "object" ? typeof value : "no object";
}
function throughArguments(value) {
  var type = typeof value;
  arguments[0] = "now a string";
  return (type == "object") + typeof value;
}
function twice(value, other) {
  var type = typeof value;
  var type = typeof other;
  return type == "object";
}
function parameter(type, value) {
  var type = typeof value;
  return type == "object";
}
function parameterUnset(type) {
  var type;
  return type == "object";
}
function closure(value) {
  const early = ask();
  var type = typeof value;
  function ask() {
    return type == "object";
  }
  return early + "," + ask();
}
function evaluated(value, text) {
  var type = typeof value;
  eval(text);
  return type == "object";
}
function labeled(value, out) {
  block: {
    if (out) break block;
    var type = typeof value;
    if (type == "object") return "inside";
  }
  return type == "object" ? "outside" : String(type);
}
function caught(value, fails) {
  try {
    if (fails) throw value;
    var type = typeof value;
    return type == "object" ? "tried" : "other";
  } catch (error) {
    return type == "object" ? "object" : String(type);
  } finally {
    if (fails === 2) return (type === "object") + "!";
  }
}
function fallsThrough(value, start) {
  switch (start) {
    case 0:
      var type = typeof value;
    case 1:
      return type == "object" ? "object" : String(type);
  }
}
function* generator(value) {
  var type = typeof value;
  value = yield type == "object";
  yield type == "object" || typeof value;
}
async function later(value) {
  var type = typeof value;
  await 1;
  return type == "object" ? "later" : "never";
}
const object = {};
console.log(readBefore(object), sometimes(object, 1), sometimes(object, 0), sometimes(1, 1), inLoop(object), changed(object), changed("list"), changedValue(object), throughArguments(object));
console.log(twice(object, 1), twice(1, object), parameter("object", 1), parameter(1, object), parameterUnset("object"), closure(object), evaluated(object, "type = 1"), evaluated(1, "var type = 'object'"), evaluated(object, ""));
console.log(labeled(object, 0), labeled(object, 1), labeled(1, 0), caught(object, 0), caught(object, 1), caught(object, 2), fallsThrough(object, 0), fallsThrough(object, 1));
const steps = generator(object);
console.log(steps.next().value, steps.next(5).value, typeof later(object));
later(object).then(console.log);
var atTop = typeof object;
console.log(atTop == "object", (() => atTop === "function")(), typeof unknownName == "undefined");
function unresolvable() {
  var type = typeof neverDeclared;
  return type == "undefined";
}
console.log(unresolvable());
