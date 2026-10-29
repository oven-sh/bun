// Prints the first stack frame of getters, setters and functions with a displayName, before and after something looks for the property `name` of the function object.
const firstFrame = stack =>
  stack
    .split("\n")[1]
    .trim()
    .replace(/ ?\(.*\)$/, "");
let seen;
function show(label, f, call, look) {
  const before = firstFrame(call());
  look(f);
  console.log(`${label} | ${before} | ${firstFrame(call())}`);
}
const getterOf = (holder, key) => Object.getOwnPropertyDescriptor(holder, key).get;
const setterOf = (holder, key) => Object.getOwnPropertyDescriptor(holder, key).set;

const a = {
  get g() {
    return new Error("x").stack;
  },
};
show(
  "getter, read",
  getterOf(a, "g"),
  () => a.g,
  f => String(f.name).length,
);
const b = {
  get g() {
    return new Error("x").stack;
  },
};
show(
  "getter, hasOwnProperty",
  getterOf(b, "g"),
  () => b.g,
  f => f.hasOwnProperty("name"),
);
const c = {
  get g() {
    return new Error("x").stack;
  },
};
show(
  "getter, getOwnPropertyNames",
  getterOf(c, "g"),
  () => c.g,
  f => Object.getOwnPropertyNames(f),
);
const d = {
  get g() {
    return new Error("x").stack;
  },
};
show(
  "getter, another property",
  getterOf(d, "g"),
  () => d.g,
  f => f.length + f.hasOwnProperty("length"),
);
const e = {
  set s(value) {
    seen = new Error("x").stack;
  },
};
show(
  "setter, read",
  setterOf(e, "s"),
  () => ((e.s = 1), seen),
  f => String(f.name).length,
);
const g = {
  set s(value) {
    seen = new Error("x").stack;
  },
};
show(
  "setter, in",
  setterOf(g, "s"),
  () => ((g.s = 1), seen),
  f => "name" in f,
);
const h = {
  set s(value) {
    seen = new Error("x").stack;
  },
};
show(
  "setter, keys",
  setterOf(h, "s"),
  () => ((h.s = 1), seen),
  f => Object.keys(f),
);
const i = {
  set s(value) {
    seen = new Error("x").stack;
  },
};
show(
  "setter, getOwnPropertyDescriptor",
  setterOf(i, "s"),
  () => ((i.s = 1), seen),
  f => Object.getOwnPropertyDescriptor(f, "name"),
);
class J {
  get g() {
    return new Error("x").stack;
  }
}
show(
  "getter of a class, Reflect.get",
  getterOf(J.prototype, "g"),
  () => new J().g,
  f => Reflect.get(f, "name"),
);
class K {
  static set s(value) {
    seen = new Error("x").stack;
  }
}
show(
  "static setter, ownKeys",
  setterOf(K, "s"),
  () => ((K.s = 1), seen),
  f => Reflect.ownKeys(f),
);
const l = {
  m() {
    return new Error("x").stack;
  },
};
show(
  "method, read",
  l.m,
  () => l.m(),
  f => String(f.name).length,
);

function read() {
  return new Error("x").stack;
}
read.displayName = "displayed";
show("displayName, read", read, read, f => String(f.name).length);
function tested() {
  return new Error("x").stack;
}
tested.displayName = "displayed";
show("displayName, hasOwn", tested, tested, f => Object.hasOwn(f, "name"));
function defined() {
  return new Error("x").stack;
}
defined.displayName = "displayed";
show("displayName, defined with the text it had", defined, defined, f =>
  Object.defineProperty(f, "name", { value: "defined" }),
);
const arrow = () => new Error("x").stack;
arrow.displayName = "displayed";
show("displayName of an arrow, read", arrow, arrow, f => String(f.name).length);
function other() {
  return new Error("x").stack;
}
other.displayName = "displayed";
show("displayName, another property", other, other, f => f.length);
class Shown {
  constructor() {
    this.stack = new Error("x").stack;
  }
}
Shown.displayName = "Displayed";
show(
  "displayName of a class, read",
  Shown,
  () => new Shown().stack,
  f => String(f.name).length,
);
