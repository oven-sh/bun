// Ways to see a declared field between its definition and the store of the constructor, and ways to keep a store of a constructor from creating an own property.
const seen: unknown[] = [];
function note(label: string, value: unknown): void {
  seen.push(label + ": " + (value === undefined ? "undefined" : typeof value === "function" ? "function" : String(value)));
}
function attempt(label: string, run: () => unknown): void {
  try {
    note(label, run());
  } catch (error) {
    note(label, "throws " + (error as Error).constructor.name);
  }
}

// An arrow function over `this` that runs before the store.
class CalledByLaterField {
  n: number;
  on = () => this.n;
  first: unknown = (0, this.on)();
  constructor(n: number) {
    this.n = n;
  }
}
note("called by a later field", new CalledByLaterField(3).first);
let saved: (() => unknown) | undefined;
class SavedOutside {
  n: number;
  on = (saved = () => this.n);
  constructor(n: number) {
    note("saved outside", saved!());
    this.n = n;
  }
}
note("saved outside, later", new SavedOutside(3).on());
class CalledByConstructor {
  n: number;
  on = () => this.n;
  constructor(n: number) {
    const on = this.on;
    note("called by the constructor", on());
    this.n = n;
  }
}
note("called by the constructor, later", new CalledByConstructor(3).on());
class NestedArrow {
  n: number;
  on = () => () => this.n;
  constructor(n: number) {
    this.n = n;
  }
}
note("nested arrow", new NestedArrow(4).on()());

// The base constructor leaves `this` where the class below finds it again without naming it.
function below() {
  let leaked: any;
  const list: any[] = [];
  const map = new Map<string, any>();
  class Leaks {
    constructor() {
      leaked = this;
      list.push(this);
      map.set("k", this);
    }
  }
  class ThroughVariable extends Leaks {
    n: number;
    early: unknown = leaked.n;
    constructor(n: number) {
      super();
      note("variable, in the constructor", leaked.n);
      this.n = n;
    }
  }
  class ThroughElement extends Leaks {
    n: number;
    early: unknown = list[list.length - 1].n;
    constructor(n: number) {
      super();
      note("element, in the constructor", list[list.length - 1].n);
      this.n = n;
    }
  }
  class ThroughMap extends Leaks {
    n: number;
    early: unknown = map.get("k").n;
    constructor(n: number) {
      super();
      note("map, in the constructor", map.get("k").n);
      this.n = n;
    }
  }
  note("variable", new ThroughVariable(1).early);
  note("element", new ThroughElement(1).early);
  note("map", new ThroughMap(1).early);
}
below();

// `#p in this` and computed keys.
class AsksForPrivateName {
  before: boolean = #p in this;
  #p: number = 1;
  after: boolean = #p in this;
  n: number;
  constructor(n: number) {
    this.n = n;
  }
}
const asks = new AsksForPrivateName(2);
note("private names", [asks.before, asks.after, asks.n].join());
const sameName: string = ["n"].join("");
class ComputedSameName {
  n!: number;
  [sameName]: unknown = "computed";
  constructor(store: boolean) {
    if (store) this.n = 7;
  }
}
note("computed, same name", new ComputedSameName(false).n);
note("computed, same name, stored", new ComputedSameName(true).n);
class ComputedInFront {
  [sameName]: unknown = "computed";
  n!: number;
  m: number;
  constructor() {
    this.m = 1;
  }
}
note("computed in front", new ComputedInFront().n);

// Stores of a constructor that do not create an own property.
class WithAccessor {
  log: string[] = [];
  constructor(w: number) {
    (this as any).w = w;
    (this as any).h = w + 1;
  }
}
class HasSetter {
  constructor(w: number) {
    (this as any).w = w;
    (this as any).h = w + 1;
  }
  set w(value: number) {
    note("setter sees h", (this as any).h);
  }
  get w() {
    return -1;
  }
}
note("accessor of the class", new HasSetter(1).w);
note("accessor of the class, h", (new HasSetter(1) as any).h);
class Plain {
  constructor(w: number) {
    (this as any).w = w;
    (this as any).h = w + 1;
  }
}
class HeirWithAccessor extends Plain {
  set w(value: number) {
    note("setter of the heir sees h", (this as any).h);
  }
  get w() {
    return -2;
  }
}
note("plain", (new Plain(1) as any).w);
note("accessor of the heir", new HeirWithAccessor(1).w);
class DefinedLater {
  constructor(w: number) {
    (this as any).w = w;
  }
}
note("before the definition", (new DefinedLater(1) as any).w);
Object.defineProperty(DefinedLater.prototype, "w", { get() { return -3; }, set() {}, configurable: true });
note("after the definition", (new DefinedLater(1) as any).w);
class BelowProxy {
  constructor(w: number) {
    (this as any).w = w;
  }
}
Object.setPrototypeOf(BelowProxy.prototype, new Proxy({}, { set(target, key) { note("trap", String(key)); return true; } }));
note("below a proxy", (new BelowProxy(1) as any).w);
class ReadOnlyAbove {
  constructor(w: number) {
    (this as any).w = w;
  }
}
Object.defineProperty(ReadOnlyAbove.prototype, "w", { value: -4, writable: false });
attempt("read-only above", () => (new ReadOnlyAbove(1) as any).w);
function makeBelow(prototype: object, value: number) {
  const made: any = { __proto__: prototype };
  made.a = value;
  return made;
}
note("literal below a setter", makeBelow({ set a(value: number) {}, get a() { return -5; } }, 1).a);
note("literal below nothing special", makeBelow({}, 1).a);
function makeEmpty(value: number) {
  const made: any = {};
  made.a = value;
  made.b = made.a + 1;
  made.c = value;
  return made;
}
const empty = makeEmpty(1);
note("empty literal", [empty.a, empty.b, empty.c, empty.d].join());
delete empty.a;
note("empty literal, deleted", makeEmpty(2).a + "," + empty.a);
function makeInner(value: number) {
  const inner: any = {};
  const outer: any = { inner };
  note("inner through outer", outer.inner.a);
  inner.a = value;
  return outer;
}
note("inner", makeInner(3).inner.a);

// Literals of constants.
function readA(o: any) {
  return o.a;
}
note("constant", readA({ a: 1 }));
const deleted: any = { a: 1, toString: 2 };
delete deleted.a;
delete deleted.toString;
note("constant, deleted", readA(deleted) + "," + typeof deleted.toString);
const redefined: any = { a: 1 };
Object.defineProperty(redefined, "a", { get() { return "getter"; } });
note("constant, redefined", readA(redefined));
const withoutGetter: any = { a: 1 };
Object.defineProperty(withoutGetter, "a", { set() {} });
note("constant, accessor without a getter", readA(withoutGetter));
note("constant, nested", readA({ a: { a: 2 } }).a);
note("constant, another name", readA({ b: 1 }));
note("constant, own __proto__", Object.keys({ ["__proto__"]: 1 }).join() + "," + typeof ({ ["__proto__"]: 1 } as any).__proto__);
note("constant, copied onto", readA(Object.assign({ a: 1 }, { get a() { return "copied"; } })));
console.log(seen.join("\n"));
