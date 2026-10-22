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

function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i];
  return sum;
}

function add(list, value) {
  return list.push(value);
}

function walk(list) {
  let text = "";
  for (const value of list) text += "<" + String(value) + ">";
  return text;
}

function doubled(list) {
  return list.map(value => value * 2);
}

function aboveOne(list) {
  return list.filter(value => value > 1);
}

function visit(list) {
  let text = "";
  list.forEach((value, key) => {
    text += String(key) + "=" + String(value) + ";";
  });
  return text;
}

function ascending(list) {
  return list.sort((a, b) => a - b);
}

function largest(list) {
  return Math.max(...list);
}

function firstAndSecond(list) {
  const [first, second] = list;
  return String(first) + "," + String(second);
}

function lastOne(list) {
  return list[list.length - 1];
}

function renumber(list) {
  for (let i = 0; i < list.length; i++) list[i] = i;
  return list.length;
}

class Ring {
  constructor(...values) {
    this.length = values.length;
    values.forEach((value, index) => {
      this[index] = value;
    });
  }
  push(value) {
    this[0] = value;
    return "a ring never grows";
  }
  map(change) {
    return new Ring(change(this[0]));
  }
  filter() {
    return this;
  }
  forEach(visit) {
    visit(this[0], "only the first");
  }
  sort() {
    return "a ring has no order";
  }
  *[Symbol.iterator]() {
    yield this[this.length - 1];
    yield this[0];
  }
}

console.log("a ring, total: " + describe(total(new Ring(3, 1, 2))));
console.log("a ring, add: " + describe(add(new Ring(3, 1, 2), 9)));
console.log("a ring, walk: " + describe(walk(new Ring(3, 1, 2))));
console.log("a ring, doubled: " + describe(doubled(new Ring(3, 1, 2))));
console.log("a ring, aboveOne: " + describe(aboveOne(new Ring(3, 1, 2))));
console.log("a ring, visit: " + describe(visit(new Ring(3, 1, 2))));
console.log("a ring, ascending: " + describe(ascending(new Ring(3, 1, 2))));
console.log("a ring, largest: " + describe(largest(new Ring(3, 1, 2))));
console.log("a ring, firstAndSecond: " + describe(firstAndSecond(new Ring(3, 1, 2))));
console.log("a ring, lastOne: " + describe(lastOne(new Ring(3, 1, 2))));
console.log("a ring, renumber: " + describe(renumber(new Ring(3, 1, 2))));

console.log("bytes, total: " + describe(total(new Uint8Array(3).fill(100))));
console.log("bytes, walk: " + describe(walk(new Uint8Array(2).fill(7))));
console.log("bytes, doubled: " + describe(doubled(new Uint8Array(2).fill(200))));
console.log("bytes, aboveOne: " + describe(aboveOne(new Uint8Array(2).fill(2))));
console.log("bytes, visit: " + describe(visit(new Uint8Array(2).fill(7))));
console.log("bytes, ascending: " + describe(ascending(Uint8Array.of(10, 9, 1))));
console.log("bytes, largest: " + describe(largest(Uint8Array.of(10, 9, 1))));
console.log("bytes, firstAndSecond: " + describe(firstAndSecond(Uint8Array.of(10, 9, 1))));
console.log("bytes, lastOne: " + describe(lastOne(Uint8Array.of(10, 9, 1))));
console.log("bytes, renumber: " + describe(renumber(new Uint8Array(3))));
attempt("bytes, add", () => add(new Uint8Array(3), 9));

console.log("text, total: " + describe(total("312")));
console.log("text, walk: " + describe(walk("312")));
console.log("text, largest: " + describe(largest("312")));
console.log("text, firstAndSecond: " + describe(firstAndSecond("312")));
console.log("text, lastOne: " + describe(lastOne("312")));
attempt("text, add", () => add("312", 9));
attempt("text, doubled", () => doubled("312"));
attempt("text, renumber", () => renumber("312"));

console.log("a set, walk: " + describe(walk(new Set("312"))));
console.log("a set, visit: " + describe(visit(new Set("312"))));
console.log("a set, total: " + describe(total(new Set("312"))));
console.log("a set, largest: " + describe(largest(new Set("312"))));
console.log("a set, firstAndSecond: " + describe(firstAndSecond(new Set("312"))));
console.log("a set, lastOne: " + describe(lastOne(new Set("312"))));
attempt("a set, add", () => add(new Set("312"), 9));

console.log("a map, walk: " + describe(walk(new Map(Object.entries({ a: 1 })))));
console.log("a map, visit: " + describe(visit(new Map(Object.entries({ a: 1 })))));
console.log("a map, firstAndSecond: " + describe(firstAndSecond(new Map(Object.entries({ a: 1 })))));

attempt("nothing, total", () => total(null));
attempt("nothing, walk", () => walk(undefined));
attempt("a number, total", () => total(5));
attempt("a number, walk", () => walk(5));
attempt("a number, lastOne", () => lastOne(5));
