function describe(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return value.length > 120 ? JSON.stringify(value.slice(0, 60)) + " and " + (value.length - 60) + " more characters" : JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  const prototype = Object.getPrototypeOf(value);
  const parts = [];
  for (const key of Reflect.ownKeys(value)) {
    const property = Reflect.getOwnPropertyDescriptor(value, key);
    parts.push(String(key) + ": " + ("value" in property ? describe(property.value) : "accessor"));
  }
  if (value instanceof Set || value instanceof Map) for (const entry of value) parts.push(describe(entry));
  if (parts.length > 16) parts.splice(8, parts.length - 16, "and " + (parts.length - 16) + " more");
  const name = prototype === null ? "no prototype" : prototype.constructor.name;
  return name + (Array.isArray(value) ? " [" + parts.join(", ") + "]" : " {" + parts.join(", ") + "}");
}

function attempt(label, run) {
  try {
    console.log(label + ": " + describe(run()));
  } catch (error) {
    console.log(label + ": threw " + error.constructor.name);
  }
}

function OldStyleList() {
  this.length = 0;
}
OldStyleList.prototype = Object.create(Array.prototype);
OldStyleList.prototype.constructor = OldStyleList;

function ListOverAnArray() {}
ListOverAnArray.prototype = [3, 1, 2];

function filled(list) {
  list[0] = 3;
  list[1] = 1;
  list[2] = 2;
  list.length = 3;
  return list;
}

const makers = {
  "Object.create(Array.prototype)": () => filled(Object.create(Array.prototype)),
  "a literal under Array.prototype": () => ({ __proto__: Array.prototype, 0: 3, 1: 1, 2: 2, length: 3 }),
  "an old-style subclass": () => filled(new OldStyleList()),
  "an old-style subclass that is empty": () => new OldStyleList(),
  "an object whose prototype is an array": () => new ListOverAnArray(),
  "an object constructed for Array": () => filled(Reflect.construct(Object, [], Array)),
  "a function under Array.prototype": () => Object.setPrototypeOf(function (a, b, c) {}, Array.prototype),
  "a typed array under Array.prototype": () => Object.setPrototypeOf(new Uint8Array([3, 1, 2]), Array.prototype),
  "a Map under Array.prototype": () => Object.setPrototypeOf(new Map([[0, 3]]), Array.prototype),
  "Array.prototype itself": () => Array.prototype,
  "an array under Object.prototype": () => Reflect.construct(Array, [3, 1, 2], Object),
  "an array": () => [3, 1, 2],
};

function lengthOf(value) {
  return value instanceof Array ? value.length : "no instance";
}

function firstOf(value) {
  return value instanceof Array ? value[0] : "no instance";
}

function pushInto(value) {
  if (!(value instanceof Array)) return "no instance";
  return [value.push(9), value.length, Object.keys(value).join()];
}

function sumOf(value) {
  if (!(value instanceof Array)) return "no instance";
  let total = 0;
  for (let i = 0; i < value.length; i++) total += value[i];
  return total;
}

function copyOf(value) {
  return value instanceof Array ? [...value] : "no instance";
}

function doubleOf(value) {
  return value instanceof Array ? value.map(element => element * 2) : "no instance";
}

function appendTo(value) {
  if (!(value instanceof Array)) return "no instance";
  value[value.length] = "appended";
  return value.length;
}

function byConstructor(value) {
  return value.constructor === Array ? [value.length, value[0], Array.isArray(value)] : "another constructor";
}

const uses = { lengthOf, firstOf, sumOf, copyOf, doubleOf, byConstructor, pushInto, appendTo };

function round(title) {
  for (const name in makers) {
    if (name === "Array.prototype itself" && title !== "at first") continue;
    for (const use in uses) {
      if (name === "Array.prototype itself" && (use === "pushInto" || use === "appendTo")) continue;
      attempt(title + ", " + use + ", " + name, () => uses[use](makers[name]()));
    }
  }
}

round("at first");
for (const use in uses) for (let i = 0; i < 2000; i++) uses[use]([3, 1, 2]);
round("after 2000 arrays");
