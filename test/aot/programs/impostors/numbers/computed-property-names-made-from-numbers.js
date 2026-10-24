function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

function keyOf(value) {
  return Object.keys({ [value]: true })[0];
}

function stored(value) {
  const object = {};
  object[value] = true;
  return Object.keys(object)[0];
}

function readBack(value) {
  const object = { [value]: "found" };
  return [object[value], object[String(value)], value in object, Object.hasOwn(object, value)];
}

function methodName(value) {
  return { [value]() {} }[value].name;
}

function classMember(value) {
  class Holder {
    [value] = "field";
    static [value] = "static";
  }
  return [Object.keys(new Holder()), Object.keys(Holder)];
}

const uses = [keyOf, stored, readBack, methodName, classMember];
const values = [0, 1, -0, -1, 1.0, 1.5, 0.1 + 0.2, 1e21, 1e-7, 1e3, 2 ** 31, 2 ** 32 - 2, 2 ** 32 - 1, 2 ** 32, 2 ** 53, 2 ** 53 + 2, NaN, Infinity, -Infinity, 0x10, 1n, -1n, 2n ** 64n, "1", "01", "1.0", "-0", true, null, undefined, [1], [1, 2], { toString: () => "text" }, { valueOf: () => 1 }];

for (let i = 0; i < 500; i++) for (const use of uses) use(i);
for (const use of uses) for (const value of values) attempt(use.name + "(" + show(value) + ")", () => use(value));

attempt("the order of keys", () =>
  Object.keys({
    b: 1,
    [2 ** 32]: 1,
    [2]: 1,
    [-1]: 1,
    [1.5]: 1,
    [2 ** 32 - 2]: 1,
    [2 ** 32 - 1]: 1,
    a: 1,
    [1]: 1,
    [-0]: 1,
    "01": 1,
    [1e21]: 1,
  }),
);
attempt("the order of keys stored one by one", () => {
  const object = {};
  for (const key of ["b", 2 ** 32, 2, -1, 1.5, 2 ** 32 - 2, 2 ** 32 - 1, "a", 1, -0, "01", 1e21]) object[key] = 1;
  return Object.keys(object);
});
attempt("equal names overwrite", () => ({ [1]: "number", ["1"]: "text", [1.0]: "fraction", [1n]: "bigint" }));
attempt("zero and negative zero", () => ({ [0]: "zero", [-0]: "negative zero" }));
