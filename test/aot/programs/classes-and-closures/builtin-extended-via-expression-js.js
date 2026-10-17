// The same as builtin-extended-via-untyped-expression.ts, where no file has types.
const loud = (Base) => class extends Base {
  loud = true;
};
const wide = (Base) => class extends Base {
  wide = 1;
};
const show = (label, run) => {
  try {
    console.log(label, String(run()));
  } catch (error) {
    console.log(label, "throws", error.name, error.message);
  }
};
function readsMap(map) {
  return [map.get("a"), map.has("a"), map.size, [...map.keys()].join()].join(" ");
}
function readsSet(set) {
  return [set.has("a"), set.size, [...set].join()].join(" ");
}
function readsDate(date) {
  return [date.getTime(), date.getFullYear() > 1900, date.toISOString()].join(" ");
}
function readsRegExp(pattern) {
  return [pattern.test("abc"), "abc".replace(pattern, "_"), pattern.source].join(" ");
}
function readsBytes(bytes) {
  return [bytes.length, bytes.indexOf(2), bytes.at(0), bytes[1]].join(" ");
}
function readsView(view) {
  return [view.byteLength, view.getInt8(0)].join(" ");
}
function readsBuffer(buffer) {
  return [buffer.byteLength, buffer.slice(1).byteLength].join(" ");
}
for (let i = 0;i < 300; i++) {
  readsMap(new Map([["a", 1]]));
  readsSet(new Set(["a"]));
  readsDate(new Date(0));
  readsRegExp(/b/);
  readsBytes(new Uint8Array([1, 2, 3]));
  readsView(new DataView(new ArrayBuffer(4)));
  readsBuffer(new ArrayBuffer(8));
}
const bases = [
  ["Map", Map, [[["a", 1]]]],
  ["Set", Set, [["a"]]],
  ["WeakMap", WeakMap, [[[globalThis, 1]]]],
  ["WeakSet", WeakSet, [[globalThis]]],
  ["Date", Date, [0]],
  ["RegExp", RegExp, ["b"]],
  ["ArrayBuffer", ArrayBuffer, [8]],
  ["DataView", DataView, [new ArrayBuffer(4)]],
  ["Uint8Array", Uint8Array, [[1, 2, 3]]],
  ["Int16Array", Int16Array, [[1, 2, 3]]],
  ["Float64Array", Float64Array, [[1, 2, 3]]],
  ["BigInt64Array", BigInt64Array, [2]],
  ["Array", Array, [1, 2, 3]],
  ["Error", Error, ["m"]],
  ["Promise", Promise, [() => {}]],
  ["Object", Object, []],
  ["Function", Function, ["return 1"]],
  ["String", String, ["s"]],
  ["Number", Number, [5]],
  ["Boolean", Boolean, [true]]
];
for (const [name, Base, given] of bases) {
  show(name + " mixin", () => {
    const made = new (loud(Base))(...given);
    return [made instanceof Base, made.loud, Object.getPrototypeOf(Object.getPrototypeOf(made)) === Base.prototype, Object.prototype.toString.call(made)].join(" ");
  });
  show(name + " wide mixin", () => {
    const made = new (wide(Base))(...given);
    return [made instanceof Base, made.wide, Object.keys(made).includes("wide")].join(" ");
  });
}
const AnyMap = Map;

class Counted extends AnyMap {
  reads = 0;
  get(key) {
    this.reads++;
    return 4242;
  }
  has() {
    return false;
  }
  get size() {
    return 77;
  }
}

class Sorted extends Set {
  has() {
    return false;
  }
  *[Symbol.iterator]() {
    yield "heir";
  }
}
const AnyDate = Date;

class Frozen extends AnyDate {
  getTime() {
    return 4242;
  }
  toISOString() {
    return "heir";
  }
}

class Never extends RegExp {
  test() {
    return false;
  }
  exec() {
    return null;
  }
}
const AnyBytes = Uint8Array;

class Bytes extends AnyBytes {
  indexOf() {
    return 4242;
  }
  at() {
    return 4243;
  }
}

class View extends DataView {
  getInt8() {
    return 42;
  }
}

class Buffer8 extends ArrayBuffer {
  slice() {
    return new ArrayBuffer(1);
  }
}
show("Map heir", () => {
  const made = new Counted([["a", 1]]);
  return readsMap(made) + " " + made.reads + " " + Map.prototype.get.call(made, "a");
});
show("Set heir", () => readsSet(new Sorted(["a"])));
show("Date heir", () => readsDate(new Frozen(0)));
show("RegExp heir", () => readsRegExp(new Never("b")));
show("Uint8Array heir", () => readsBytes(new Bytes([1, 2, 3])));
show("DataView heir", () => readsView(new View(new ArrayBuffer(4))));
show("ArrayBuffer heir", () => readsBuffer(new Buffer8(8)));
show("plain ones after the heirs", () => [readsMap(new Map([["a", 1]])), readsSet(new Set(["a"])), readsDate(new Date(0)), readsRegExp(/b/), readsBytes(new Uint8Array([1, 2, 3])), readsView(new DataView(new ArrayBuffer(4))), readsBuffer(new ArrayBuffer(8))].join(" | "));
show("through a bound function", () => new (loud(Map.bind(null)))([["a", 1]]).get("a"));
show("through a proxy", () => new (loud(new Proxy(Set, {})))(["a"]).has("a"));
show("an heir of an heir", () => {
  const made = new (loud(loud(Date)))(0);
  return [made instanceof Date, made.getTime(), made.loud].join(" ");
});
show("no constructor", () => new (loud({})));
show("null", () => Object.getPrototypeOf(loud(null).prototype));
