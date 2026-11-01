// The members that built-in prototypes are created with cannot be changed, but most of these prototypes take new names. A program puts an accessor `last` on Array.prototype, a method on Map.prototype, a getter under a symbol on Function.prototype; and names that the language itself looks for: toJSON, then, valueOf, Symbol.toPrimitive. From then on a fresh array, map, closure or error that a helper "only reads", awaits, adds or prints runs code that keeps it.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
// No array: Array.prototype is what is being changed.
const kept = new Set();
const report = () => {
  const tags = [];
  for (const k of kept) tags[tags.length] = typeof k === "function" ? "function " + k() : k instanceof Map || k instanceof Set ? "collection of " + k.size : Array.isArray(k) ? "[" + Array.prototype.join.call(k) + "]" : k instanceof Error ? k.message : typeof k + " " + String(k);
  kept.clear();
  return tags.join(" | ");
};
const mark = Symbol("mark");
function lastOf(list) {
  return list.last;
}
function setLast(list, v) {
  list.last = v;
  return list.length;
}
function callKeep(x) {
  return typeof x.keepMe === "function" ? x.keepMe() : "no method";
}
function firstOf(collection) {
  return collection.first;
}
function markOf(f) {
  return f[mark];
}
function detailOf(e) {
  return e.detail;
}
function toText(x) {
  return JSON.stringify(x);
}
async function awaits(x) {
  return await x;
}
function minusOne(x) {
  return x - 1;
}
function inTemplate(x) {
  return `${x}`;
}
function plusText(x) {
  return x + "";
}
function concatenated(x) {
  return [0].concat(x).length;
}
function round(i) {
  const captured = { i };
  return [
    lastOf([i, i + 1]),
    setLast([i], i),
    callKeep([i]),
    callKeep(new Map([[i, i]])),
    firstOf(new Map([[i, i]])),
    firstOf(new Set([i])),
    markOf(() => captured.i),
    detailOf(new Error("error " + i)),
    toText([i]),
    toText(new Map([[i, i]])),
    minusOne([i]),
    inTemplate([i, i]),
    plusText([i]),
    concatenated([i, i]),
    lastOf("text" + i),
    lastOf(i),
  ].map(String).join(",");
}
let line = "";
for (let i = 0; i < 1000; i++) line = round(i);
console.log(line, kept.size);
console.log(String(await awaits([1, 2])), kept.size);

const added = [];
function define(holder, key, descriptor) {
  Object.defineProperty(holder, key, { configurable: true, ...descriptor });
  added[added.length] = [holder, key];
}
define(Array.prototype, "last", {
  get() {
    kept.add(this);
    return this[this.length - 1];
  },
  set(v) {
    kept.add(this).add(v);
  },
});
define(Array.prototype, "keepMe", {
  value() {
    kept.add(this);
    return "kept an array";
  },
});
define(Map.prototype, "keepMe", {
  value() {
    kept.add(this);
    return "kept a map";
  },
});
for (const holder of [Map.prototype, Set.prototype]) {
  define(holder, "first", {
    get() {
      kept.add(this);
      return this.values().next().value;
    },
  });
}
define(Function.prototype, mark, {
  get() {
    kept.add(this);
    return "marked";
  },
});
define(Error.prototype, "detail", {
  get() {
    kept.add(this);
    return "detail of " + this.message;
  },
});
for (const holder of [String.prototype, Number.prototype]) {
  define(holder, "last", {
    get() {
      kept.add(this);
      return typeof this;
    },
  });
}
console.log(round(1000));
console.log(churn(60), report());

// Names that the language and the host look for by themselves. Arrays refuse these; maps, sets, errors and dates take them.
for (const holder of [Map.prototype, Set.prototype, Error.prototype]) {
  define(holder, "toJSON", {
    value() {
      kept.add(this);
      return this instanceof Error ? "an error's toJSON" : [...this];
    },
  });
}
console.log(toText(new Map([[3, 4]])), toText({ inner: new Set([5]) }), toText(new Error("to JSON")), toText([new Error("nested")]), churn(30), report());
define(Error.prototype, "valueOf", {
  value() {
    kept.add(this);
    return 100;
  },
});
console.log(minusOne(new Error("minus")), plusText(new Error("plus")), new Error("less") < 200, new Error("equal") == 100, churn(30), report());
define(Error.prototype, Symbol.toPrimitive, {
  value(hint) {
    kept.add(this);
    return hint === "number" ? 7 : hint;
  },
});
console.log(minusOne(new Error("number")), plusText(new Error("default")), inTemplate(new Error("string")), ({ string: "by key" })[new Error("key")], churn(30), report());
for (const holder of [Error.prototype, WeakRef.prototype]) {
  define(holder, "then", {
    value(resolve) {
      kept.add(this);
      resolve((this instanceof Error ? "an error" : "a weak reference") + " was a thenable");
    },
  });
}
console.log(await awaits(new Error("awaited")), await Promise.resolve(new Error("resolved")), await (async () => new Error("returned"))(), (await Promise.all([new Error("in all")]))[0], await awaits(new WeakRef({})), churn(30), kept.size);
kept.clear();
delete Error.prototype.then;
delete WeakRef.prototype.then;
define(Error.prototype, Symbol.iterator, {
  *value() {
    kept.add(this);
    yield this.message;
  },
});
function spread(x) {
  return [...x].length;
}
function firstByPattern([a]) {
  return a;
}
console.log(spread(new Error("spread")), firstByPattern(new Error("pattern")), Array.from(new Error("from")).join(), new Set(new Error("set")).size, churn(30), report());
define(Error.prototype, Symbol.isConcatSpreadable, {
  get() {
    kept.add(this);
    return false;
  },
});
console.log(concatenated(new Error("concatenated")), churn(30), report());
const custom = Symbol.for("nodejs.util.inspect.custom");
for (const holder of [Array.prototype, Map.prototype]) {
  define(holder, custom, {
    value() {
      kept.add(this);
      return "inspected";
    },
  });
}
function shown(x) {
  return Bun.inspect(x);
}
console.log(shown([20]), shown({ inner: [21] }), shown(new Map([[22, 22]])));
console.log([23], new Map([[24, 24]]));
console.log(churn(30), report());
delete Array.prototype[custom];
delete Map.prototype[custom];

// Fresh objects on a rare path of a hot loop, while everything is in place.
let hot = 0;
for (let i = 0; i < 300; i++) {
  hot += lastOf(i % 100 === 99 ? [i, i] : { last: 1 });
  hot += String(markOf(i % 100 === 98 ? () => i : { [mark]: 1 })).length;
}
console.log(hot, churn(60), report());

for (const [holder, key] of added) delete holder[key];
console.log(round(2000), kept.size);
console.log(String(await awaits([1, 2])), kept.size);
