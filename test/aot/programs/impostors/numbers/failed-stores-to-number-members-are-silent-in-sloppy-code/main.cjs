function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "function") return "function";
  if (typeof value !== "object" || value === null) return String(value);
  if (Array.isArray(value)) {
    const parts = [];
    for (let i = 0; i < value.length; i++) parts.push(i in value ? show(value[i]) : "<hole>");
    return "[" + parts.join(", ") + "]";
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) return Object.prototype.toString.call(value);
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function outcome(run) {
  try {
    return show(run());
  } catch (error) {
    return "threw " + error.constructor.name;
  }
}

function attempt(label, run) {
  console.log(label, "->", outcome(run));
}

function increment(holder) {
  var result = holder.n++;
  return [result, holder.n];
}

function add(holder, amount) {
  var result = (holder.n += amount);
  return [result, holder.n];
}

function assign(holder, value) {
  var result = (holder.n = value);
  return [result, holder.n];
}

function incrementElement(list) {
  var result = ++list[0];
  return [result, list[0], list.length];
}

function push(list, value) {
  return [list.push(value), list];
}

var holders = {
  "plain": function () { return { n: 1 }; },
  "frozen": function () { return Object.freeze({ n: 1 }); },
  "sealed": function () { return Object.seal({ n: 1 }); },
  "not writable": function () { return Object.defineProperty({}, "n", { value: 1, enumerable: true }); },
  "a getter only": function () { return { get n() { return 1; } }; },
  "inherited and not writable": function () { return Object.create(Object.freeze({ n: 1 })); },
  "inherited getter only": function () { return Object.create({ get n() { return 1; } }); },
  "not extensible and without the member": function () { return Object.preventExtensions({}); },
  "a number": function () { return 5; },
  "a text": function () { return "text"; },
  "a proxy that refuses": function () { return new Proxy({ n: 1 }, { set: function () { return false; } }); },
};

for (var i = 0; i < 2000; i++) {
  increment({ n: i });
  add({ n: i }, 1);
  assign({ n: i }, 2);
  incrementElement([i]);
}

Object.keys(holders).forEach(function (name) {
  attempt("increment " + name, function () { return increment(holders[name]()); });
  attempt("add 1 to " + name, function () { return add(holders[name](), 1); });
  attempt("add '1' to " + name, function () { return add(holders[name](), "1"); });
  attempt("assign 2.5 to " + name, function () { return assign(holders[name](), 2.5); });
});
attempt("incrementElement of a frozen array", function () { return incrementElement(Object.freeze([1])); });
attempt("incrementElement of an empty frozen array", function () { return incrementElement(Object.freeze([])); });
attempt("incrementElement of a text", function () { return incrementElement("5"); });
attempt("push to a frozen array", function () { return push(Object.freeze([1]), 2); });
attempt("a length that is not writable", function () {
  var list = Object.defineProperty([1, 2], "length", { writable: false });
  list.length = 0;
  list[5] = 1;
  return [list, list.length];
});
attempt("NaN, Infinity and undefined are not writable", function () {
  NaN = 1;
  Infinity = 2;
  undefined = 3;
  return [NaN, Infinity, undefined];
});
attempt("Math.PI is not writable", function () {
  Math.PI = 3;
  Math.PI++;
  return Math.PI;
});
attempt("Number.MAX_SAFE_INTEGER is not writable", function () {
  Number.MAX_SAFE_INTEGER++;
  return Number.MAX_SAFE_INTEGER;
});
