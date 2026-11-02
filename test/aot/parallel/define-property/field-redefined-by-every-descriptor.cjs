// A property that a compiled object holds in a field is redefined by every kind of descriptor, written at the call and handed in.
const written = [];
function describe(object) {
  const parts = [];
  for (const key of Reflect.ownKeys(object)) {
    const d = Object.getOwnPropertyDescriptor(object, key);
    const held = "value" in d ? "v=" + String(d.value) + (d.writable ? "W" : "w") : "g=" + (d.get ? String(d.get.call(object)) : "none") + ",s=" + (d.set ? "yes" : "none");
    parts.push(String(key) + ":" + held + (d.enumerable ? "E" : "e") + (d.configurable ? "C" : "c"));
  }
  const listed = [];
  for (const key in object) listed.push(key);
  return parts.join(" ") + " | " + Object.keys(object).join() + " | " + listed.join() + " | " + JSON.stringify(object);
}
function attempt(label, action) {
  try {
    const result = action();
    return label + "=" + (typeof result === "object" || typeof result === "function" ? "object" : String(result));
  } catch (error) {
    return label + " threw " + error.constructor.name;
  }
}

class Point {
  a = 1;
  b = undefined;
  c = "x";
}
function Old() {
  this.a = 1;
  this.b = 2;
  this.c = 3;
}
class WithAccessor {
  a = 1;
  c = 3;
}
const receivers = {
  literal: () => ({ a: 1, b: undefined, c: "x" }),
  instance: () => new Point(),
  constructed: () => new Old(),
  assignedLater: () => {
    const o = {};
    o.c = o.b = o.a = void 0;
    return o;
  },
  accessorInLiteral: () => ({
    a: 1,
    get b() {
      return "old";
    },
    set b(value) {
      written.push("old setter " + value);
    },
    c: 3,
  }),
  getterDefined: () => {
    const o = { a: 1 };
    Object.defineProperty(o, "b", { enumerable: true, configurable: true, get: () => "defined" });
    o.c = 3;
    return o;
  },
  hiddenValue: () => {
    const o = { a: 1 };
    Object.defineProperty(o, "b", { value: 5, configurable: true });
    o.c = 3;
    return o;
  },
  fixedValue: () => {
    const o = { a: 1 };
    Object.defineProperty(o, "b", { value: 5, writable: true });
    o.c = 3;
    return o;
  },
  sealed: () => Object.seal({ a: 1, b: 2, c: 3 }),
  frozen: () => Object.freeze({ a: 1, b: 2, c: 3 }),
  closed: () => Object.preventExtensions({ a: 1, b: 2, c: 3 }),
  withExtra: () => {
    const o = { a: 1, b: 2, c: 3 };
    o["extra" + written.length * 0] = 4;
    return o;
  },
};

const get = () => "got";
const set = value => written.push("set " + value);
const definitions = {
  getter: [o => Object.defineProperty(o, "b", { get }), () => ({ get })],
  getterListed: [o => Object.defineProperty(o, "b", { enumerable: true, get }), () => ({ enumerable: true, get })],
  getterHidden: [o => Object.defineProperty(o, "b", { enumerable: false, get }), () => ({ enumerable: false, get })],
  getterFixed: [o => Object.defineProperty(o, "b", { configurable: false, get }), () => ({ configurable: false, get })],
  setter: [o => Object.defineProperty(o, "b", { set }), () => ({ set })],
  both: [o => Object.defineProperty(o, "b", { get, set, enumerable: true, configurable: true }), () => ({ get, set, enumerable: true, configurable: true })],
  noGetter: [o => Object.defineProperty(o, "b", { get: undefined }), () => ({ get: undefined })],
  value: [o => Object.defineProperty(o, "b", { value: 7 }), () => ({ value: 7 })],
  valueOfOtherType: [o => Object.defineProperty(o, "b", { value: "text" }), () => ({ value: "text" })],
  valueUndefined: [o => Object.defineProperty(o, "b", { value: undefined }), () => ({ value: undefined })],
  valueReadOnly: [o => Object.defineProperty(o, "b", { value: 7, writable: false }), () => ({ value: 7, writable: false })],
  readOnly: [o => Object.defineProperty(o, "b", { writable: false }), () => ({ writable: false })],
  writable: [o => Object.defineProperty(o, "b", { writable: true }), () => ({ writable: true })],
  hidden: [o => Object.defineProperty(o, "b", { enumerable: false }), () => ({ enumerable: false })],
  listed: [o => Object.defineProperty(o, "b", { enumerable: true }), () => ({ enumerable: true })],
  fixed: [o => Object.defineProperty(o, "b", { configurable: false }), () => ({ configurable: false })],
  nothing: [o => Object.defineProperty(o, "b", {}), () => ({})],
  plain: [o => Object.defineProperty(o, "b", { value: 8, writable: true, enumerable: true, configurable: true }), () => ({ value: 8, writable: true, enumerable: true, configurable: true })],
  allFalse: [o => Object.defineProperty(o, "b", { value: 9, writable: false, enumerable: false, configurable: false }), () => ({ value: 9, writable: false, enumerable: false, configurable: false })],
};

const ways = {
  written: (o, [atCall]) => atCall(o),
  handedIn: (o, [, make]) => Object.defineProperty(o, "b", make()),
  byKey: (o, [, make]) => Object.defineProperty(o, ["b"][written.length * 0], make()),
  reflected: (o, [, make]) => Reflect.defineProperty(o, "b", make()),
  several: (o, [, make]) => Object.defineProperties(o, { b: make() }),
  copied: (o, [, make]) => Object.defineProperties(o, Object.getOwnPropertyDescriptors(Object.defineProperty({}, "b", { configurable: true, ...make() }))),
};

for (const [receiver, create] of Object.entries(receivers)) {
  for (const [definition, forms] of Object.entries(definitions)) {
    for (const [way, define] of Object.entries(ways)) {
      const o = create();
      const child = Object.create(o);
      const lines = [attempt("define", () => define(o, forms)), describe(o)];
      lines.push(attempt("read", () => o.b), attempt("inherited", () => child.b));
      lines.push(attempt("store", () => ((o.b = 11), o.b)), attempt("strict store", () => { "use strict"; o.b = 12; return o.b; }));
      lines.push(attempt("store below", () => ((child.b = 13), Object.keys(child).join() + child.b)));
      lines.push(attempt("again", () => Object.defineProperty(o, "b", { value: 14, enumerable: true })), describe(o));
      lines.push(attempt("delete", () => delete o.b), attempt("add", () => ((o.b = 15), o.b)), describe(o));
      console.log(receiver, definition, way, "::", lines.join(" ; "), written.splice(0).join());
    }
  }
}
