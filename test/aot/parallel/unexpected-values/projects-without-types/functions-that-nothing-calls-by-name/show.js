export function show(value, depth) {
  depth = depth || 0;
  switch (typeof value) {
    case "number":
      return Object.is(value, -0) ? "-0" : String(value);
    case "string":
      return JSON.stringify(value);
    case "bigint":
      return value + "n";
    case "function":
      return "function " + value.name;
    case "symbol":
    case "undefined":
    case "boolean":
      return String(value);
  }
  if (value === null) return "null";
  if (depth > 2) return "...";
  var parent = Object.getPrototypeOf(value);
  var kind = parent === null ? "no-prototype" : typeof parent.constructor === "function" ? parent.constructor.name : "odd-prototype";
  var parts = [];
  if (Array.isArray(value)) {
    for (var i = 0; i < value.length; i++) parts.push(i in value ? show(value[i], depth + 1) : "hole");
    return kind + "[" + parts.join(", ") + "]";
  }
  if (value instanceof Map || value instanceof Set) return kind + "(" + show(Array.from(value), depth + 1) + ")";
  Reflect.ownKeys(value).forEach(function (key) {
    var property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? show(property.value, depth + 1) : "accessor"));
  });
  return kind + "{" + parts.join(", ") + "}";
}

export function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}
