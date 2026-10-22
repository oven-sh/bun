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

var stores = {
  member: value => {
    value.extra = 1;
    return value.extra;
  },
  element: value => {
    value[0] = "z";
    return value[0];
  },
  length: value => {
    value.length = 1;
    return value.length;
  },
  computed: value => {
    value["ex" + "tra"] = 1;
    return value.extra;
  },
  addTo: value => {
    value.extra += 1;
    return value.extra;
  },
  increment: value => {
    value.extra++;
    return value.extra;
  },
  pastTheEnd: value => {
    value[10] = "z";
    return value[10];
  },
  remove: value => delete value.extra,
  removeElement: value => delete value[0],
  removeLength: value => delete value.length,
  inherited: value => {
    value.toString = 1;
    return typeof value.toString;
  },
};
var values = { object: () => ({ 0: "a", length: 3 }), list: () => ["a", "b", "c"], text: () => "abc", emptyText: () => "", number: () => 5, yes: () => true, big: () => 5n, symbol: () => Symbol.iterator, none: () => null, nothing: () => undefined, boxedText: () => new String("abc") };
for (var i = 0; i < 2000; i++) for (var store in stores) stores[store]({ 0: "a", length: 3 });
for (var value in values) for (var store in stores) attempt(store + "(" + value + ")", stores[store].bind(null, values[value]()));

export {};
