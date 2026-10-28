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

const log = [];

function key(name) {
  return {
    toString() {
      log.push("key " + name);
      return name;
    },
  };
}

let turn = 0;
const changing = {
  toString() {
    turn++;
    log.push("turn " + turn);
    return "k" + turn;
  },
};

function value(name) {
  log.push("value " + name);
  return name;
}

function object(name, made) {
  log.push("object " + name);
  return made;
}

function report(label, run) {
  attempt(label, run);
  console.log("  order:", log.splice(0).join(", "));
}

function read(table, k) {
  return table[k];
}

function store(table, k, v) {
  table[k] = v;
  return table;
}

function addTo(table, k) {
  table[k] += 1;
  return table;
}

function increment(table, k) {
  table[k]++;
  return table;
}

function incrementBefore(table, k) {
  return [++table[k], table];
}

function orAssign(table, k) {
  table[k] ||= "assigned";
  return table;
}

function nullishAssign(table, k) {
  table[k] ??= "assigned";
  return table;
}

function andAssign(table, k) {
  table[k] &&= "assigned";
  return table;
}

function callMember(table, k) {
  return table[k]();
}

function remove(table, k) {
  return [delete table[k], table];
}

for (let i = 0; i < 2000; i++) {
  read({ a: 1 }, "a");
  store({}, "a", 1);
  addTo({ a: 1 }, "a");
  increment({ a: 1 }, "a");
  incrementBefore({ a: 1 }, "a");
  orAssign({}, "a");
  nullishAssign({}, "a");
  andAssign({ a: 1 }, "a");
  callMember({ a() {} }, "a");
  remove({ a: 1 }, "a");
}

report("read", () => read({ a: 1 }, key("a")));
report("store", () => store({}, key("a"), 1));
report("+=", () => addTo({ a: 1 }, key("a")));
report("++ after", () => increment({ a: 1 }, key("a")));
report("++ before", () => incrementBefore({ a: 1 }, key("a")));
report("||=", () => orAssign({}, key("a")));
report("||= that does not assign", () => orAssign({ a: 1 }, key("a")));
report("??=", () => nullishAssign({}, key("a")));
report("&&=", () => andAssign({ a: 1 }, key("a")));
report("call", () => callMember({ a() { return this === undefined ? "no this" : "with this"; } }, key("a")));
report("delete", () => remove({ a: 1 }, key("a")));

report("a key that changes: +=", () => addTo({ k1: 1, k2: 10, k3: 100 }, changing));
report("a key that changes: ++", () => increment({ k1: 1, k2: 10, k3: 100, k4: 1000 }, changing));
report("a key that changes: ||=", () => orAssign({}, changing));
report("a key that changes: read twice", () => [read({ k4: "four", k5: "five", k6: "six" }, changing), read({ k4: "four", k5: "five", k6: "six" }, changing)]);

report("object, key, value", () => (object("o", {})[key("a")] = value("v")));
report("object, key expression, value expression", () => {
  const table = {};
  object("o", table)[(log.push("key expression"), key("a"))] = value("v");
  return table;
});
report("a store into null with a key and a value", () => (object("null", null)[key("a")] = value("v")));
report("a store into undefined with a key and a value", () => (object("undefined", undefined)[key("a")] = value("v")));
report("a read from null with a key", () => object("null", null)[key("a")]);
report("a call on null with a key and an argument", () => object("null", null)[key("a")](value("argument")));
report("a call of a missing member with an argument", () => object("o", {})[key("a")](value("argument")));
report("delete from null with a key", () => delete object("null", null)[key("a")]);
report("+= on null with a key and a value", () => (object("null", null)[key("a")] += value("v")));
report("in with a key and an object", () => key("a") in object("o", { a: 1 }));
report("in with a key and a text", () => key("a") in object("text", "text"));
report("a literal with two computed keys", () => ({ [key("b")]: value("b"), [key("a")]: value("a") }));
report("a pattern with two computed keys and defaults", () => {
  const { [key("b")]: b = value("default b"), [key("a")]: a = value("default a") } = object("o", { a: 1 });
  return [a, b];
});
report("a pattern that stores into computed members", () => {
  const target = {};
  ({ x: object("target", target)[key("first")], y: object("target", target)[key("second")] } = object("source", { x: 1, y: 2 }));
  return target;
});
report("a key that is a symbol wrapper", () => read({ [Symbol.for("s")]: "by symbol" }, { [Symbol.toPrimitive]: hint => (log.push("hint " + hint), Symbol.for("s")) }));
report("super with a key", () => {
  class Base {
    a() {
      return "base a";
    }
  }
  class Derived extends Base {
    a() {
      return super[key("a")]();
    }
  }
  return new Derived().a();
});
