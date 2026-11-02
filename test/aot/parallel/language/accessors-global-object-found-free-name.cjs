// Getters and setters of the global object see the same `this` as under plain Bun, whether a free name or `globalThis.name` finds them. Sloppy code.
const seen = [];
function describe(value) {
  return value === globalThis ? "global" : value === undefined ? "undefined" : value === null ? "null" : typeof value;
}
function note(label, value) {
  seen.push(label + "=" + describe(value));
}
function flush(title) {
  console.log(title + ": " + seen.join(" "));
  seen.length = 0;
}
function attempt(label, run) {
  try {
    console.log(label + ":", run());
  } catch (error) {
    console.log(label + ": throws", error.constructor.name);
  }
}

Object.defineProperty(globalThis, "accessor", {
  configurable: true,
  get: function () {
    return this;
  },
  set: function (value) {
    note("set", this);
  },
});
note("first", accessor);
for (let i = 0; i < 3; i++) note("loop", accessor);
note("member", globalThis.accessor);
flush("getter");
accessor = 1;
for (let i = 0; i < 3; i++) accessor = i;
globalThis.accessor = 1;
flush("setter");
console.log("typeof:", typeof accessor);
accessor += 1;
accessor++;
accessor ||= 1;
accessor &&= 1;
accessor ??= 1;
flush("compound assignments");

Object.defineProperty(globalThis, "comparesThis", {
  configurable: true,
  get: function () {
    return [this === globalThis, this === undefined, typeof this].join();
  },
});
console.log("compares this:", comparesThis, comparesThis, globalThis.comparesThis);

Object.defineProperty(globalThis, "method", {
  configurable: true,
  get() {
    return this;
  },
});
note("first", method);
note("second", method);
flush("getter written as a method");

globalThis.__defineGetter__("definedGetter", function () {
  return this;
});
note("first", definedGetter);
note("second", definedGetter);
flush("__defineGetter__");

Object.defineProperty(globalThis, "arrowGetter", { configurable: true, get: () => 5 });
console.log("arrow:", arrowGetter, arrowGetter);
const receiver = { name: "bound" };
Object.defineProperty(globalThis, "boundGetter", {
  configurable: true,
  get: function () {
    return this;
  }.bind(receiver),
});
console.log("bound:", boundGetter === receiver, boundGetter === receiver);

Object.defineProperty(globalThis, "readsMember", {
  configurable: true,
  get: function () {
    return typeof this.accessor;
  },
});
attempt("reads a member of this", () => readsMember);
attempt("reads a member of this", () => globalThis.readsMember);

const holder = {
  get shared() {
    return this;
  },
};
Object.defineProperty(globalThis, "sharedGetter", Object.getOwnPropertyDescriptor(holder, "shared"));
note("by name", sharedGetter);
console.log("on its holder:", holder.shared === holder);
flush("getter of two objects");

function readsInside() {
  return accessor;
}
note("first", readsInside());
note("second", readsInside());
note("arrow", (() => accessor)());
flush("read inside a function");

for (let i = 0; i < 4; i++) attempt("__proto__", () => __proto__ === Object.getPrototypeOf(globalThis));
Object.defineProperty(globalThis, "nativeGetter", {
  configurable: true,
  get: Object.getOwnPropertyDescriptor(Object.prototype, "__proto__").get,
});
for (let i = 0; i < 4; i++) attempt("native getter", () => nativeGetter === Object.getPrototypeOf(globalThis));
attempt("native getter as a member", () => globalThis.nativeGetter === Object.getPrototypeOf(globalThis));
