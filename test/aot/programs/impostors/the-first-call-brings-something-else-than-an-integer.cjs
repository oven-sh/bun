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

function truncates1(n) {
  return n | 0;
}
attempt("truncates: a string comes first", () => truncates1("3"));
attempt("truncates: an integer comes second", () => truncates1(7));
attempt("truncates: a string comes third", () => truncates1("3"));

function truncates2(n) {
  return n | 0;
}
attempt("truncates: an object with valueOf comes first", () => truncates2(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })));
attempt("truncates: an integer comes second", () => truncates2(7));
attempt("truncates: an object with valueOf comes third", () => truncates2(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })));

function truncates3(n) {
  return n | 0;
}
attempt("truncates: a bigint comes first", () => truncates3(10n));
attempt("truncates: an integer comes second", () => truncates3(7));
attempt("truncates: a bigint comes third", () => truncates3(10n));

function truncates4(n) {
  return n | 0;
}
attempt("truncates: the largest int32 comes first", () => truncates4(2147483647));
attempt("truncates: an integer comes second", () => truncates4(7));
attempt("truncates: the largest int32 comes third", () => truncates4(2147483647));

function truncates5(n) {
  return n | 0;
}
attempt("truncates: minus zero comes first", () => truncates5(-0));
attempt("truncates: an integer comes second", () => truncates5(7));
attempt("truncates: minus zero comes third", () => truncates5(-0));

function truncates6(n) {
  return n | 0;
}
attempt("truncates: undefined comes first", () => truncates6(undefined));
attempt("truncates: an integer comes second", () => truncates6(7));
attempt("truncates: undefined comes third", () => truncates6(undefined));

function addsOne1(n) {
  return n + 1;
}
attempt("addsOne: a string comes first", () => addsOne1("3"));
attempt("addsOne: an integer comes second", () => addsOne1(7));
attempt("addsOne: a string comes third", () => addsOne1("3"));

function addsOne2(n) {
  return n + 1;
}
attempt("addsOne: an object with valueOf comes first", () => addsOne2(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })));
attempt("addsOne: an integer comes second", () => addsOne2(7));
attempt("addsOne: an object with valueOf comes third", () => addsOne2(({ valueOf() { log.push("valueOf"); return 2 ** 31 + 0.5; }, toString() { log.push("toString"); return "text"; } })));

function addsOne3(n) {
  return n + 1;
}
attempt("addsOne: a bigint comes first", () => addsOne3(10n));
attempt("addsOne: an integer comes second", () => addsOne3(7));
attempt("addsOne: a bigint comes third", () => addsOne3(10n));

function addsOne4(n) {
  return n + 1;
}
attempt("addsOne: the largest int32 comes first", () => addsOne4(2147483647));
attempt("addsOne: an integer comes second", () => addsOne4(7));
attempt("addsOne: the largest int32 comes third", () => addsOne4(2147483647));

function addsOne5(n) {
  return n + 1;
}
attempt("addsOne: minus zero comes first", () => addsOne5(-0));
attempt("addsOne: an integer comes second", () => addsOne5(7));
attempt("addsOne: minus zero comes third", () => addsOne5(-0));

function addsOne6(n) {
  return n + 1;
}
attempt("addsOne: undefined comes first", () => addsOne6(undefined));
attempt("addsOne: an integer comes second", () => addsOne6(7));
attempt("addsOne: undefined comes third", () => addsOne6(undefined));
