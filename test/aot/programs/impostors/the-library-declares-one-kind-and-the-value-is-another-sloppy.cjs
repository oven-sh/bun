const log = [];

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (value instanceof Error) return value.constructor.name;
  const parent = Object.getPrototypeOf(value);
  const kind = parent === Object.prototype || parent === Array.prototype ? "" : parent === null ? "bare " : parent.constructor.name + " ";
  const isList = Array.isArray(value);
  const parts = [];
  if (isList) for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "hole");
  for (const key of Reflect.ownKeys(value)) {
    if (isList && typeof key === "string" && (key === "length" || /^\d+$/.test(key))) continue;
    parts.push(String(key) + ": " + show(value[key]));
  }
  return kind + (isList ? "[" : "{") + parts.join(", ") + (isList ? "]" : "}");
}

function outcome(run) {
  log.length = 0;
  try {
    const value = run();
    const effects = log.join(", ");
    return show(value) + (effects ? " | " + effects : "");
  } catch (error) {
    const effects = log.join(", ");
    return "threw " + show(error) + (effects ? " | " + effects : "");
  }
}

function attempt(label, run) {
  console.log(label + " -> " + outcome(run));
}

console.log("strict:", (function () { return this === undefined; })());

const traps = {
  get(target, key, receiver) {
    log.push("get " + String(key));
    return Reflect.get(target, key, receiver);
  },
  set(target, key, value, receiver) {
    log.push("set " + String(key));
    return Reflect.set(target, key, value, receiver);
  },
  apply(target, self, list) {
    log.push("apply " + list.length);
    return Reflect.apply(target, self, list);
  },
};
class Point {
  x = 1;
  y = 2;
  sum() {
    return this.x + this.y;
  }
}
class List extends Array {
  push(value) {
    log.push("List.push " + value);
    return 42;
  }
}
class Chosen extends Array {
  static get [Symbol.species]() {
    return List;
  }
}

attempt("a proxy of an array, pushed to", () => {
  const a = new Proxy([5, 6], traps);
  a.push(1);
  return a.length;
});
attempt("a proxy of an array, iterated", () => {
  const a = new Proxy([5, 6], traps);
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
});
attempt("a proxy of an array, read by index", () => {
  const a = new Proxy([5, 6], traps);
  let total = 0;
  for (let i = 0; i < a.length; i++) total += a[i];
  return total;
});
attempt("a proxy of an object, read", () => {
  const o = new Proxy({ x: 1, y: 2 }, traps);
  return o.x + o.y;
});
attempt("a proxy of an object, stored to", () => {
  const o = new Proxy({ x: 1, y: 2 }, traps);
  o.x = 5;
  return o.x;
});
attempt("a proxy of an instance, its method called", () => {
  const p = new Proxy(new Point(), traps);
  return p.sum();
});
attempt("a proxy of a function, called", () => {
  const f = new Proxy(x => x + 1, traps);
  return f(1);
});
attempt("a proxy that answers every read with a text", () => {
  const o = new Proxy({ x: 1, y: 2 }, { get: () => "t" });
  return [o.x + o.y, o.x | 0];
});
attempt("a clone of an instance, its method called", () => {
  const p = structuredClone(new Point());
  return [p.x + p.y, typeof p.sum];
});
attempt("a clone of a subclass of Array, pushed to", () => {
  const a = structuredClone(new List(5, 6));
  return [a.push(1), a.length];
});
attempt("a frozen array, pushed to", () => {
  const a = Object.freeze([5, 6]);
  a.push(1);
  return a.length;
});
attempt("a frozen array, stored to", () => {
  const a = Object.freeze([5, 6]);
  a[0] = 9;
  return a[0];
});
attempt("a frozen object, stored to", () => {
  const o = Object.freeze({ x: 1, y: 2 });
  o.x = 5;
  return o.x;
});
attempt("an array that Object.assign gave its own push", () => {
  const a = Object.assign([5, 6], { push: () => "own push" });
  return [a.push(1), a.length];
});
attempt("an object whose member Object.defineProperty made a getter", () => {
  const o = Object.defineProperty({ x: 1, y: 2 }, "x", { get() { log.push("get x"); return "text"; } });
  return o.x + o.y;
});
attempt("an object whose members Object.defineProperties made getters", () => {
  const o = Object.defineProperties({ x: 1, y: 2 }, { x: { get: () => "a" }, y: { get: () => "b" } });
  return o.x + o.y;
});
attempt("an array that got the prototype of a subclass", () => {
  const a = Object.setPrototypeOf([5, 6], List.prototype);
  return [a.push(1), a.length];
});
attempt("what map returns for a subclass with a species", () => {
  const a = new Chosen(5, 6).map(x => x * 2);
  return [a.push(1), a.length];
});
attempt("what filter returns for a subclass with a species", () => {
  const a = new Chosen(5, 6).filter(() => true);
  return [a.push(1), a.length];
});
attempt("what slice returns for an array with its own constructor", () => {
  const list = [5, 6];
  list.constructor = Chosen;
  const a = list.slice();
  return [a.push(1), a.length];
});
attempt("what split returns for an object with Symbol.split", () => {
  const a = "a,b".split({ [Symbol.split]: () => new Set(["from a set"]) });
  const seen = [];
  for (const x of a) seen.push(x);
  return [seen, a.length];
});
attempt("what replace returns for an object with Symbol.replace", () => {
  const s = "abc".replace({ [Symbol.replace]: () => 65 }, "x");
  return [typeof s, s + 1];
});
attempt("what search returns for an object with Symbol.search", () => {
  const n = "abc".search({ [Symbol.search]: () => "3" });
  return [n + 1, n | 0];
});
attempt("Array.from of a length alone", () => {
  const a = Array.from({ length: 2 });
  return [a[0] + 1, a[0] | 0, 0 in a];
});
attempt("Array of a length", () => {
  const a = Array(2);
  return [a[0] + 1, a[0] | 0, 0 in a, a.length];
});
attempt("new Array of a length, filled by push", () => {
  const a = new Array(2);
  a.push(1);
  let total = 0;
  for (const x of a) total += x;
  return [a.length, total];
});
attempt("an element past the end", () => {
  const a = [5, 6];
  const n = a[2];
  return [n + 1, n | 0];
});
attempt("a character past the end", () => {
  const s = "abc"[3];
  return [typeof s, s + 1];
});
attempt("an entry past the end", () => {
  const entry = Object.entries({ a: 1 })[1];
  return entry[0];
});
attempt("a number through Object", () => {
  const n = Object(7);
  return [typeof n, n + 1, n === 7];
});
attempt("a text through Object", () => {
  const s = Object("abc");
  return [typeof s, s.charCodeAt(0), s === "abc"];
});
attempt("a number stored in the environment", () => {
  process.env.IMPOSTOR_NUMBER = 7;
  const n = process.env.IMPOSTOR_NUMBER;
  delete process.env.IMPOSTOR_NUMBER;
  return n + 1;
});
attempt("Number called as a constructor", () => {
  const n = new Number(7);
  return [typeof n, n + 1, n ? "truthy" : "falsy", new Number(0) ? "truthy" : "falsy"];
});
attempt("a class constructed for another", () => {
  const p = Reflect.construct(Point, [], List);
  return [p.x + p.y, typeof p.sum, typeof p.push];
});
attempt("an object made from the prototype of a class", () => {
  const p = Object.create(Point.prototype);
  return [p.sum(), Object.keys(p)];
});
