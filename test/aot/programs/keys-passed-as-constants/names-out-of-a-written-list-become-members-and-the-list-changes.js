// A loop over a written list of names gives objects one member a name; each member is a closure over the name.
const lines = [];
const say = (...parts) => lines.push(parts.map(String).join(" "));
const hidden = process.argv.length > 9 ? "x" : "";
class Counter {
  counts = { get: 0, put: 0, head: 0, late: 0 };
}
const verbs = ["get", "put", "head"];
verbs.forEach(function (verb, index, list) {
  Counter.prototype[verb] = function (by) {
    this.counts[verb] += by;
    return this;
  };
  if (index === 0) list.push("la" + hidden + "te");
});
const counter = new Counter();
counter.get(1).put(2).head(3).get(5);
say(typeof counter.late, verbs.join());
verbs.forEach(function (verb) {
  Counter.prototype[verb + hidden] = function (by) {
    this.counts[verb] -= by;
    return this;
  };
});
counter.get(1).late(4);
say(JSON.stringify(counter.counts), Object.getOwnPropertyNames(Counter.prototype).join());
// The callback is called by hand, with other names, with none.
function define(name) {
  Counter.prototype[name] = function () {
    return name + ":" + typeof this.counts[name];
  };
}
["get", "put"].forEach(define);
define("head");
define("no" + hidden + "ne");
define();
define(7);
say(counter.get(), counter.put(), counter.head(), counter.none(), counter.undefined(), counter[7]());
// map, filter, some, for-of, a Set, and a list with holes and other things in it.
const made = ["a", "b"].map(name => () => ({ [name]: name }));
say(JSON.stringify(made.map(make => make())));
const mixed = ["a", , 1, null, undefined, "b", { toString: () => "c" }];
const readers = [];
mixed.forEach(name => readers.push(from => from[name]));
const from = { a: 1, b: 2, c: 3, 1: "one", null: "n", undefined: "u" };
say(readers.map(read => read(from)).join());
const holder = {};
for (const name of ["x", "y", "x"]) {
  Object.defineProperty(holder, name, {
    get() {
      return this.values[name];
    },
    set(value) {
      this.values[name] = value;
    },
    configurable: true,
    enumerable: name === "x",
  });
}
holder.values = { x: 1, y: 2 };
holder.x = 10;
holder.y += 5;
say(holder.x, holder.y, Object.keys(holder).join(), JSON.stringify(holder.values));
// forEach of somebody else.
const impostor = {
  forEach(callback) {
    callback("put");
    callback("imp" + hidden + "ostor");
  },
};
const stored = {};
impostor.forEach(function (name) {
  stored[name] = function () {
    return this === stored && name;
  };
});
say(stored.put(), stored.impostor());
console.log(lines.join("\n"));
