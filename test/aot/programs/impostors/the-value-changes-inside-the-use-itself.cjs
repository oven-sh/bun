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

class Odd extends Array {
  push(value) {
    log.push("Odd.push " + value);
    return 42;
  }
  *[Symbol.iterator]() {
    log.push("Odd.iterator");
    yield "odd";
  }
}

function logged(target) {
  return new Proxy(target, {
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
  });
}

console.log("strict:", (function () { return this === undefined; })());

function pushesWhatACallReturns(a, change) {
  const result = a.push(change(a));
  return [result, a.length];
}
function iteratesAndChanges(a, change) {
  const seen = [];
  for (const x of a) {
    seen.push(x);
    if (seen.length === 1) change(a);
    if (seen.length > 8) break;
  }
  return seen;
}
function addsMembers(o) {
  return o.x + o.y;
}
function storesWhatACallReturns(o, change) {
  o.x = change(o);
  return o.x;
}
function callsWithWhatACallReturns(f, other) {
  return f((f = other, 1));
}
function addsTwo(n, m) {
  return n + m;
}
function readsCharCodeAt(s, index) {
  return s.charCodeAt(index);
}

for (let i = 0; i < 2000; i++) {
  pushesWhatACallReturns([5, 6], () => 1);
  iteratesAndChanges([5, 6], () => {});
  addsMembers({ x: 1, y: 2 });
  storesWhatACallReturns({ x: 0, y: 2 }, () => 1);
  callsWithWhatACallReturns(x => x + 1, x => x + 1);
  addsTwo(1, 2);
  readsCharCodeAt("abc", 0);
}

const arrayChanges = [
  ["nothing", () => 1],
  ["its prototype becomes that of a subclass", a => (Object.setPrototypeOf(a, Odd.prototype), 1)],
  ["it gets its own push", a => ((a.push = () => "own push"), 1)],
  ["it is frozen", a => (Object.freeze(a), 1)],
  ["it is emptied", a => ((a.length = 0), 1)],
  ["it grows by two", a => (Array.prototype.push.call(a, 7, 8), 1)],
  ["the next element is deleted", a => (delete a[1], 1)],
  ["the next element becomes an accessor", a => (Object.defineProperty(a, 1, { get() { log.push("get 1"); return "got"; } }), 1)],
  ["the next element becomes a fraction", a => ((a[1] = 0.5), 1)],
  ["its length stops being writable", a => (Object.defineProperty(a, "length", { writable: false }), 1)],
];
for (const [label, change] of [...arrayChanges, arrayChanges[0]]) {
  attempt("push, while its argument is evaluated " + label, () => pushesWhatACallReturns([5, 6], change));
  attempt("for-of, in the first iteration " + label, () => iteratesAndChanges([5, 6], change));
}

const getters = [
  ["deletes y", o => delete o.y],
  ["makes y a text", o => { o.y = "2"; }],
  ["makes y an accessor", o => Object.defineProperty(o, "y", { get() { log.push("get y"); return 20; } })],
  ["replaces the prototype after deleting y", o => { delete o.y; Object.setPrototypeOf(o, { y: "inherited" }); }],
  ["adds a hundred members", o => { for (let k = 0; k < 100; k++) o["k" + k] = k; }],
  ["makes itself a plain member", o => Object.defineProperty(o, "x", { value: 100 })],
];
for (const [label, change] of getters) {
  attempt("o.x + o.y, the getter of x " + label, () => {
    const o = { get x() { log.push("get x"); change(this); return 1; }, y: 2 };
    return [addsMembers(o), addsMembers(o), addsMembers({ x: 1, y: 2 })];
  });
}

const objectChanges = [
  ["nothing", () => 1],
  ["it is frozen", o => (Object.freeze(o), 1)],
  ["x becomes an accessor", o => (Object.defineProperty(o, "x", { get() { return "got"; }, set(value) { log.push("set x " + value); } }), 1)],
  ["x is deleted", o => (delete o.x, 1)],
  ["x stops being writable", o => (Object.defineProperty(o, "x", { writable: false }), 1)],
  ["x is deleted and extensions are prevented", o => (delete o.x, Object.preventExtensions(o), 1)],
];
for (const [label, change] of [...objectChanges, objectChanges[0]]) {
  attempt("o.x = .., while the value is evaluated " + label, () => {
    const o = { x: 0, y: 2 };
    return [storesWhatACallReturns(o, change), o];
  });
}

attempt("f(..), while its argument is evaluated f becomes a class", () => callsWithWhatACallReturns(x => x + 1, class Made {}));
attempt("f(..), while its argument is evaluated f becomes undefined", () => callsWithWhatACallReturns(x => x + 1, undefined));
attempt("f(..), a class at first", () => callsWithWhatACallReturns(class Made {}, x => x + 1));

attempt("n + m, the valueOf of n changes that of m", () => {
  const m = { valueOf() { log.push("first valueOf of m"); return 2; } };
  const n = { valueOf() { log.push("valueOf of n"); m.valueOf = () => { log.push("second valueOf of m"); return "two"; }; return 1; } };
  return [addsTwo(n, m), addsTwo(1, 2)];
});
attempt("n + m, the valueOf of n gives m a Symbol.toPrimitive", () => {
  const m = { valueOf() { log.push("valueOf of m"); return 2; } };
  const n = { valueOf() { log.push("valueOf of n"); m[Symbol.toPrimitive] = hint => { log.push("hint " + hint); return 10n; }; return 1n; } };
  return [addsTwo(n, m), addsTwo(1, 2)];
});
attempt("s.charCodeAt(index), the valueOf of the index gives s its own charCodeAt", () => {
  const s = new String("abc");
  const index = { valueOf() { log.push("valueOf"); s.charCodeAt = () => "own"; return 1; } };
  return [readsCharCodeAt(s, index), readsCharCodeAt(s, index), readsCharCodeAt("abc", 1)];
});
