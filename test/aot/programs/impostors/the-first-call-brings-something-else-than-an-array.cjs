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

function pushes1(a) {
  a.push(1);
  return a.length;
}
attempt("pushes: a subclass comes first", () => pushes1(Odd.of(5, 6)));
attempt("pushes: an array comes second", () => pushes1([5, 6]));
attempt("pushes: a subclass comes third", () => pushes1(Odd.of(5, 6)));

function pushes2(a) {
  a.push(1);
  return a.length;
}
attempt("pushes: an array-like comes first", () => pushes2(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })));
attempt("pushes: an array comes second", () => pushes2([5, 6]));
attempt("pushes: an array-like comes third", () => pushes2(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })));

function pushes3(a) {
  a.push(1);
  return a.length;
}
attempt("pushes: a proxy comes first", () => pushes3(logged([5, 6])));
attempt("pushes: an array comes second", () => pushes3([5, 6]));
attempt("pushes: a proxy comes third", () => pushes3(logged([5, 6])));

function pushes4(a) {
  a.push(1);
  return a.length;
}
attempt("pushes: a frozen array comes first", () => pushes4(Object.freeze([5, 6])));
attempt("pushes: an array comes second", () => pushes4([5, 6]));
attempt("pushes: a frozen array comes third", () => pushes4(Object.freeze([5, 6])));

function pushes5(a) {
  a.push(1);
  return a.length;
}
attempt("pushes: a string comes first", () => pushes5("ab"));
attempt("pushes: an array comes second", () => pushes5([5, 6]));
attempt("pushes: a string comes third", () => pushes5("ab"));

function iterates1(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}
attempt("iterates: a subclass comes first", () => iterates1(Odd.of(5, 6)));
attempt("iterates: an array comes second", () => iterates1([5, 6]));
attempt("iterates: a subclass comes third", () => iterates1(Odd.of(5, 6)));

function iterates2(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}
attempt("iterates: an array-like comes first", () => iterates2(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })));
attempt("iterates: an array comes second", () => iterates2([5, 6]));
attempt("iterates: an array-like comes third", () => iterates2(({ 0: 5, length: 7, push(value) { log.push("own push " + value); return "pushed"; }, [Symbol.iterator]() { log.push("own iterator"); return [8, 9][Symbol.iterator](); } })));

function iterates3(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}
attempt("iterates: a proxy comes first", () => iterates3(logged([5, 6])));
attempt("iterates: an array comes second", () => iterates3([5, 6]));
attempt("iterates: a proxy comes third", () => iterates3(logged([5, 6])));

function iterates4(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}
attempt("iterates: a frozen array comes first", () => iterates4(Object.freeze([5, 6])));
attempt("iterates: an array comes second", () => iterates4([5, 6]));
attempt("iterates: a frozen array comes third", () => iterates4(Object.freeze([5, 6])));

function iterates5(a) {
  const seen = [];
  for (const x of a) seen.push(x);
  return seen;
}
attempt("iterates: a string comes first", () => iterates5("ab"));
attempt("iterates: an array comes second", () => iterates5([5, 6]));
attempt("iterates: a string comes third", () => iterates5("ab"));
