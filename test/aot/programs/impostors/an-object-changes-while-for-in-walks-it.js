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

function walk(value, visit) {
  const seen = [];
  for (const key in value) {
    seen.push(key);
    visit(value, key);
  }
  return seen;
}

function walkIntoAMember(value, holder) {
  const seen = [];
  for (holder.key in value) seen.push(typeof holder.key + " " + holder.key);
  return seen;
}

function walkIntoAnElement(value) {
  const slots = [];
  let i = 0;
  for (slots[i++] in value);
  return slots;
}

function walkWithVar(value) {
  for (var key in value);
  return key;
}

for (let i = 0; i < 2000; i++) {
  walk({ a: 1, b: 2 }, () => {});
  walkIntoAMember({ a: 1 }, {});
  walkIntoAnElement({ a: 1 });
  walkWithVar({ a: 1 });
}

attempt("a later key is deleted", () => walk({ a: 1, b: 2, c: 3 }, (object, key) => { if (key === "a") delete object.b; }));
attempt("the current key is deleted", () => walk({ a: 1, b: 2, c: 3 }, (object, key) => { delete object[key]; }));
attempt("a key is added", () => walk({ a: 1, b: 2 }, (object, key) => { object["added after " + key] = 1; }).length);
attempt("a later key is deleted and added again", () => walk({ a: 1, b: 2, c: 3 }, (object, key) => { if (key === "a") { delete object.c; object.c = 4; } }));
attempt("a later key stops being enumerable", () => walk({ a: 1, b: 2, c: 3 }, (object, key) => { if (key === "a") Object.defineProperty(object, "b", { enumerable: false }); }));
attempt("a later element of a list is removed", () => walk(["x", "y", "z"], (list, key) => { if (key === "0") list.length = 1; }));
attempt("a list grows", () => walk(["x", "y"], (list, key) => { if (list.length < 5) list.push("more"); }));
attempt("a later element of a list is deleted", () => walk(["x", "y", "z"], (list, key) => { if (key === "0") delete list[1]; }));
attempt("the prototype is changed", () => walk(Object.create({ inherited: 1 }, { own: { value: 1, enumerable: true, configurable: true } }), (object, key) => { if (key === "own") Object.setPrototypeOf(object, { other: 2 }); }));
attempt("an inherited key is deleted from the prototype", () => {
  const parent = { first: 1, second: 2 };
  return walk(Object.create(parent, { own: { value: 1, enumerable: true } }), (object, key) => { if (key === "own") delete parent.second; });
});
attempt("an own key is added that shadows an inherited one", () => walk(Object.create({ inherited: 1 }, { own: { value: 1, enumerable: true, writable: true } }), (object, key) => { if (key === "own") Object.defineProperty(object, "inherited", { value: 2, enumerable: false }); }));
attempt("the object becomes a dictionary", () => walk({ a: 1, b: 2, c: 3 }, (object, key) => { if (key === "a") for (let i = 0; i < 100; i++) { object["t" + i] = i; delete object["t" + i]; } }));
attempt("the variable is a member with a setter", () => {
  const log = [];
  const seen = walkIntoAMember({ a: 1, 0: 2 }, { set key(value) { log.push(typeof value + " " + value); }, get key() { return "from the getter"; } });
  return [seen, log];
});
attempt("the variable is a member of a frozen object", () => walkIntoAMember({ a: 1 }, Object.freeze({ key: "frozen" })));
attempt("the variable is an element", () => walkIntoAnElement({ a: 1, 5: 2, b: 3 }));
attempt("the variable is an element, over a text", () => walkIntoAnElement("hey"));
attempt("the variable afterwards", () => [walkWithVar({ a: 1, b: 2 }), walkWithVar([7, 8]), walkWithVar({}), walkWithVar(null), walkWithVar("xy")]);
attempt("a Proxy is asked in this order", () => {
  const log = [];
  const proxy = new Proxy({ a: 1, b: 2 }, {
    ownKeys(target) { log.push("ownKeys"); return Reflect.ownKeys(target); },
    getOwnPropertyDescriptor(target, key) { log.push("describe " + String(key)); return Reflect.getOwnPropertyDescriptor(target, key); },
    getPrototypeOf(target) { log.push("getPrototypeOf"); return null; },
    get(target, key) { log.push("get " + String(key)); return target[key]; },
    has(target, key) { log.push("has " + String(key)); return key in target; },
  });
  return [walk(proxy, (object, key) => object[key]), log];
});
attempt("a Proxy that names keys twice is refused", () => walk(new Proxy({}, { ownKeys() { return ["a", "a"]; } }), () => {}));
attempt("a Proxy that names a number is refused", () => walk(new Proxy({}, { ownKeys() { return [1]; } }), () => {}));
attempt("a Proxy that names keys that do not exist", () => walk(new Proxy({}, { ownKeys() { return ["ghost"]; } }), () => {}));
