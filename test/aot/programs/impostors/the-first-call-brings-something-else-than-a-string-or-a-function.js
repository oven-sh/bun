"use strict";

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

function readsCharCode1(s) {
  return s.charCodeAt(0);
}
attempt("readsCharCode: an object with charCodeAt comes first", () => readsCharCode1(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })));
attempt("readsCharCode: a string comes second", () => readsCharCode1("abc"));
attempt("readsCharCode: an object with charCodeAt comes third", () => readsCharCode1(({ charCodeAt(index) { log.push("own charCodeAt " + index); return "mine"; } })));

function readsCharCode2(s) {
  return s.charCodeAt(0);
}
attempt("readsCharCode: a String object with its own charCodeAt comes first", () => readsCharCode2(Object.assign(new String("xyz"), { charCodeAt: () => -1 })));
attempt("readsCharCode: a string comes second", () => readsCharCode2("abc"));
attempt("readsCharCode: a String object with its own charCodeAt comes third", () => readsCharCode2(Object.assign(new String("xyz"), { charCodeAt: () => -1 })));

function readsCharCode3(s) {
  return s.charCodeAt(0);
}
attempt("readsCharCode: an array comes first", () => readsCharCode3(["abc"]));
attempt("readsCharCode: a string comes second", () => readsCharCode3("abc"));
attempt("readsCharCode: an array comes third", () => readsCharCode3(["abc"]));

function readsCharCode4(s) {
  return s.charCodeAt(0);
}
attempt("readsCharCode: a number comes first", () => readsCharCode4(65));
attempt("readsCharCode: a string comes second", () => readsCharCode4("abc"));
attempt("readsCharCode: a number comes third", () => readsCharCode4(65));

function calls1(f) {
  return f(1);
}
attempt("calls: a class comes first", () => calls1(class Made { constructor(x) { log.push("constructed " + x); } }));
attempt("calls: a function comes second", () => calls1(x => x + 1));
attempt("calls: a class comes third", () => calls1(class Made { constructor(x) { log.push("constructed " + x); } }));

function calls2(f) {
  return f(1);
}
attempt("calls: a callable proxy comes first", () => calls2(logged(x => x + 2)));
attempt("calls: a function comes second", () => calls2(x => x + 1));
attempt("calls: a callable proxy comes third", () => calls2(logged(x => x + 2)));

function calls3(f) {
  return f(1);
}
attempt("calls: a bound function comes first", () => calls3(function (a, b) { return [this.tag, a, b]; }.bind({ tag: "bound" }, "first")));
attempt("calls: a function comes second", () => calls3(x => x + 1));
attempt("calls: a bound function comes third", () => calls3(function (a, b) { return [this.tag, a, b]; }.bind({ tag: "bound" }, "first")));

function calls4(f) {
  return f(1);
}
attempt("calls: an object with call comes first", () => calls4(({ call() { log.push("call"); return "called"; } })));
attempt("calls: a function comes second", () => calls4(x => x + 1));
attempt("calls: an object with call comes third", () => calls4(({ call() { log.push("call"); return "called"; } })));
