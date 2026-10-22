console.log("strict:", (function () {
  return this === undefined;
})());

function show(value) {
  if (typeof value === "number") return Object.is(value, -0) ? "-0" : String(value);
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "bigint") return value + "n";
  if (typeof value === "function") return "function " + value.name;
  if (typeof value !== "object" || value === null) return String(value);
  if (value === globalThis) return "the global object";
  if (Array.isArray(value)) return "[" + Array.from(value, (item, index) => (index in value ? show(item) : "hole")).join(", ") + "]";
  var tag = Object.prototype.toString.call(value).slice(8, -1);
  if (tag === "Arguments") return "arguments" + show(Array.from(value));
  if (/^(Number|String|Boolean|BigInt|Symbol)$/.test(tag)) return "boxed " + show(Object.getPrototypeOf(value).valueOf.call(value));
  return "{" + Object.keys(value).map(key => key + ": " + show(value[key])).join(", ") + "}";
}

function attempt(label, run) {
  try {
    console.log(label, show(run()));
  } catch (error) {
    console.log(label, "threw", error.constructor.name);
  }
}

function kind() {
  return typeof this;
}
function same(value) {
  return this === value;
}
function store() {
  this.note = "stored";
  return this.note;
}
function itself() {
  return this;
}
var parents = { number: Number.prototype, text: String.prototype, yes: Boolean.prototype, big: BigInt.prototype, symbol: Symbol.prototype };
for (var name in parents) {
  Object.defineProperty(parents[name], "addedKind", { value: kind, configurable: true });
  Object.defineProperty(parents[name], "addedSame", { value: same, configurable: true });
  Object.defineProperty(parents[name], "addedStore", { value: store, configurable: true });
  Object.defineProperty(parents[name], "addedItself", { value: itself, configurable: true });
  Object.defineProperty(parents[name], "addedGetter", { get: kind, configurable: true });
  Object.defineProperty(parents[name], "addedSetter", {
    set: function (value) {
      seen.push(typeof this);
    },
    configurable: true,
  });
}
var seen = [];
var values = { number: 5, text: "abc", yes: true, big: 5n, symbol: Symbol.iterator };
function callKind(value) {
  return value.addedKind();
}
function readGetter(value) {
  return value.addedGetter;
}
var honest = { addedKind: kind, addedGetter: "object" };
var length = 0;
for (var i = 0; i < 2000; i++) length += callKind(honest).length + readGetter(honest).length;
console.log("length", length);
for (var name in values) {
  var value = values[name];
  attempt(name + ".addedKind()", () => callKind(value));
  attempt(name + ".addedSame(itself)", () => value.addedSame(value));
  attempt(name + ".addedStore()", () => value.addedStore());
  attempt(name + ".addedItself()", () => value.addedItself());
  attempt(name + ".addedGetter", () => readGetter(value));
  attempt(name + "['addedGetter']", () => value["added" + "Getter"]);
  attempt(name + ".addedSetter = 1", () => {
    seen.length = 0;
    value.addedSetter = 1;
    return seen;
  });
  attempt(name + "?.addedKind()", () => value?.addedKind());
  attempt(name + " unpacked", () => {
    var { addedGetter } = value;
    return addedGetter;
  });
}
attempt("a literal number", () => [(5).addedKind(), 5..addedKind(), (5.5).addedGetter]);
attempt("a literal text", () => ["abc".addedKind(), "abc".addedGetter, `abc`.addedKind()]);
for (var name in parents) for (var key of ["addedKind", "addedSame", "addedStore", "addedItself", "addedGetter", "addedSetter"]) delete parents[name][key];
attempt("after they were removed", () => callKind(5));

export {};
