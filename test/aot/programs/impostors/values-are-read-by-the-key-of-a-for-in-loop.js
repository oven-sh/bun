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

function sumValues(object) {
  let total = 0;
  for (const key in object) total += object[key];
  return total;
}

function copy(object) {
  const result = {};
  for (const key in object) result[key] = object[key];
  return result;
}

function ownOnly(object) {
  const seen = [];
  for (const key in object) {
    if (Object.prototype.hasOwnProperty.call(object, key)) seen.push(key + "=" + object[key]);
  }
  return seen;
}

function readFromAnother(object, other) {
  const seen = [];
  for (const key in object) seen.push(other[key]);
  return seen;
}

function keyIsChanged(object) {
  const seen = [];
  for (let key in object) {
    key = key + "x";
    seen.push(object[key]);
  }
  return seen;
}

function objectIsChanged(object, replacement) {
  const seen = [];
  for (const key in object) {
    seen.push(object[key]);
    object = replacement;
  }
  return seen;
}

function doubledInPlace(object) {
  for (const key in object) object[key] = object[key] * 2;
  return object;
}

function removedInPlace(object) {
  for (const key in object) delete object[key];
  return Object.keys(object);
}

for (let i = 0; i < 2000; i++) {
  sumValues({ a: 1, b: 2 });
  copy({ a: 1, b: 2 });
  ownOnly({ a: 1, b: 2 });
  readFromAnother({ a: 1, b: 2 }, { a: 3, b: 4 });
  keyIsChanged({ a: 1, ax: 2 });
  objectIsChanged({ a: 1, b: 2 }, { a: 3, b: 4 });
  doubledInPlace({ a: 1, b: 2 });
  removedInPlace({ a: 1, b: 2 });
}

const log = [];
attempt("a getter deletes the next member", () => sumValues({ get a() { delete this.b; return 1; }, b: 2, c: 4 }));
attempt("a getter adds a member", () => sumValues({ get a() { this.d = 8; return 1; }, b: 2 }));
attempt("a getter replaces the next member by a text", () => sumValues({ get a() { this.b = "two"; return 1; }, b: 2, c: 4 }));
attempt("a getter makes the next member a getter", () => sumValues({ get a() { Object.defineProperty(this, "b", { get: () => 100, enumerable: true }); return 1; }, b: 2 }));
attempt("a getter turns the object into a dictionary", () => sumValues({ get a() { for (let i = 0; i < 70; i++) { this["t" + i] = 0; delete this["t" + i]; } return 1; }, b: 2, c: 4 }));
attempt("a getter changes the prototype", () => sumValues(Object.create({ inherited: 16 }, { a: { get() { Object.setPrototypeOf(this, { inherited: 32, other: 64 }); return 1; }, enumerable: true } })));
attempt("inherited members are read through the object", () => sumValues(Object.create({ a: 1, get b() { return this.c; } }, { c: { value: 4, enumerable: true } })));
attempt("an own member shadows an inherited one", () => [sumValues(Object.create({ a: 1 }, { a: { value: 10, enumerable: true } })), sumValues(Object.create({ a: 1 }, { a: { value: 10, enumerable: false } }))]);
attempt("values of a list", () => [sumValues([1, 2, 3]), sumValues([1, , 3]), sumValues(Object.assign([1], { extra: 5 }))]);
attempt("values of a text", () => [sumValues("ab"), sumValues(new String("ab")), sumValues("")]);
attempt("values of bytes", () => sumValues(new Uint8Array([1, 2])));
attempt("values of null and undefined", () => [sumValues(null), sumValues(undefined), sumValues(5)]);
attempt("values that are not numbers", () => [sumValues({ a: "x", b: 1 }), sumValues({ a: 1, b: null }), sumValues({ a: undefined }), sumValues({ a: [1], b: [2] })]);
attempt("a BigInt among numbers", () => sumValues({ a: 1, b: 2n }));
attempt("a copy keeps order and takes inherited members", () => JSON.stringify(copy(Object.create({ z: 1 }, { b: { value: 2, enumerable: true }, 1: { value: 3, enumerable: true }, a: { value: 4, enumerable: true } }))));
attempt("a copy of an object that owns __proto__", () => {
  const result = copy(JSON.parse('{ "__proto__": { "polluted": true }, "a": 1 }'));
  return [Object.keys(result), result.polluted, Object.getPrototypeOf(result) === Object.prototype];
});
attempt("own only", () => ownOnly(Object.create({ inherited: 1 }, { own: { value: 2, enumerable: true } })));
attempt("read from another of the same shape", () => readFromAnother({ a: 1, b: 2 }, { a: "x", b: "y" }));
attempt("read from another with the members in another order", () => readFromAnother({ a: 1, b: 2 }, { b: "y", a: "x" }));
attempt("read from another that lacks a member", () => readFromAnother({ a: 1, b: 2 }, { a: "x" }));
attempt("read from another that is a list", () => readFromAnother({ 0: 1, length: 2 }, ["x"]));
attempt("read from another that is a text", () => readFromAnother({ 0: 1, length: 2, at: 3 }, "xy").map(value => typeof value));
attempt("read from another that is null", () => readFromAnother({ a: 1 }, null));
attempt("read from null with no keys", () => readFromAnother({}, null));
attempt("the key is changed", () => keyIsChanged({ a: 1, ax: 2, axx: 3 }));
attempt("the object is changed", () => objectIsChanged({ a: 1, b: 2, c: 3 }, { a: "x", b: "y" }));
attempt("the object is changed to a text", () => objectIsChanged({ 0: 1, 1: 2, length: 3 }, "xy"));
attempt("doubled in place", () => [doubledInPlace({ a: 1, b: "2", c: "x" }), doubledInPlace([1, 2]), doubledInPlace(new Uint8Array([100, 200]))]);
attempt("doubled in place with a setter", () => {
  const object = { set a(value) { log.push("set " + value); }, get a() { return 21; }, b: 1 };
  return [doubledInPlace(object).b, log.splice(0)];
});
attempt("doubled in place, frozen", () => doubledInPlace(Object.freeze({ a: 1 })));
attempt("doubled in place, a text", () => doubledInPlace("12"));
attempt("removed in place", () => [removedInPlace({ a: 1, b: 2 }), removedInPlace([1, 2]), removedInPlace(Object.create({ inherited: 1 }))]);
attempt("removed in place, sealed", () => removedInPlace(Object.seal({ a: 1 })));
