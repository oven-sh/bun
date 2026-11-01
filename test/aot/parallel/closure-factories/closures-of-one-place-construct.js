// Closures of one place in the text, made at each call of a factory: their prototypes, calls without new, getters in place of values, Symbol.hasInstance.
const lines = [];
const show = (label, value) => lines.push(label + ": " + (typeof value === "string" ? value : JSON.stringify(value)));
const attempt = (label, action) => {
  try {
    show(label, action());
  } catch (error) {
    show(label, error.constructor.name);
  }
};
const shared = { value: undefined, enumerable: false };
function makeKind(label, fill, parent) {
  function fillIn(self, options) {
    if (!self.inner) {
      shared.value = { options, labels: new Set() };
      try {
        Object.defineProperty(self, "inner", shared);
      } finally {
        shared.value = undefined;
      }
    } else if (self.inner.labels.has(label)) return;
    self.inner.labels.add(label);
    fill(self, options);
  }
  function Kind(options) {
    const self = parent ? Object.create(parent.prototype) : this;
    fillIn(self, options);
    return self;
  }
  Object.defineProperty(Kind, "fillIn", { value: fillIn });
  Object.defineProperty(Kind, Symbol.hasInstance, { value: (object) => !!object?.inner?.labels?.has(label) });
  Object.defineProperty(Kind, "name", { value: label });
  return Kind;
}
const Base = makeKind("Base", (self, options) => {
  self.weight = options.weight ?? 0;
});
const Point = makeKind("Point", (self, options) => {
  Base.fillIn(self, options);
  self.x = options.x;
});
const Span = makeKind("Span", (self, options) => {
  Base.fillIn(self, options);
  self.from = options.from;
});
const Below = makeKind("Below", (self, options) => {
  Point.fillIn(self, options);
  self.deep = true;
}, Point);
Point.prototype.describe = function () {
  return "point " + this.x + " " + this.weight;
};
Span.prototype.describe = function () {
  return "span " + this.from + " " + this.weight;
};
function look(label, thing) {
  show(label, [thing.weight, thing.x, thing.from, thing.deep, Object.keys(thing), [...thing.inner.labels]]);
  show(label + " is", [thing instanceof Base, thing instanceof Point, thing instanceof Span, thing instanceof Below]);
  attempt(label + " describe", () => thing.describe());
  show(label + " chain", [Object.getPrototypeOf(thing) === Point.prototype, Object.getPrototypeOf(thing) === Span.prototype, Object.getPrototypeOf(thing) === Base.prototype, thing.constructor.name]);
}
const mixed = [];
for (let i = 0; i < 12; i++) mixed.push(i % 3 === 0 ? new Point({ x: i, weight: 1 }) : i % 3 === 1 ? new Span({ from: i }) : new Below({ x: -i, weight: 2 }));
mixed.forEach((thing, index) => look("mixed " + index, thing));
let sum = 0;
for (let round = 0; round < 200; round++) for (const thing of mixed) sum += thing.weight + thing.inner.labels.size + (thing.x ?? thing.from);
show("sum", sum);

// The prototype object of one closure is replaced, and another one's is changed.
const early = new Point({ x: 1 });
Point.prototype = { describe() { return "replaced " + this.x; }, extra: 5 };
const late = new Point({ x: 2 });
look("early", early);
look("late", late);
show("extra", [early.extra, late.extra]);
Object.setPrototypeOf(Span.prototype, { inherited: "from above", get weightTwice() { return this.weight * 2; } });
const span = new Span({ from: 3, weight: 4 });
show("span above", [span.inherited, span.weightTwice, mixed[1].inherited, mixed[1].weightTwice]);
Span.prototype.from = "on the prototype";
delete span.from;
show("span deleted", [span.from, mixed[1].from]);
Object.setPrototypeOf(span, null);
show("span without prototype", [span.weight, typeof span.describe, Object.keys(span)]);
Span.prototype = 5;
const plainBelow = new Span({ from: 6 });
show("prototype is a number", [Object.getPrototypeOf(plainBelow) === Object.prototype, plainBelow.from]);

// Called without new.
attempt("call sloppy", () => {
  const answer = Base({ weight: 9 });
  const was = [answer === globalThis, globalThis.weight, Object.getOwnPropertyDescriptor(globalThis, "inner")?.enumerable];
  delete globalThis.weight;
  return was;
});
attempt("call on object", () => {
  const target = { own: 1 };
  const answer = Point.call(target, { x: 8, weight: 3 });
  return [answer === target, Object.keys(target), target instanceof Point, target.inner.labels.size];
});
attempt("call on primitive", () => typeof Base.call(5, { weight: 1 }));
attempt("apply on frozen", () => Point.apply(Object.freeze({}), [{ x: 1 }]));
attempt("reflect construct", () => {
  class Other {}
  const made = Reflect.construct(Point, [{ x: 4 }], Other);
  return [made instanceof Other, Object.getPrototypeOf(made) === Other.prototype, made.x, made instanceof Point];
});
attempt("bound", () => {
  const Bound = Span.bind(null, { from: 11, weight: 12 });
  const made = new Bound();
  return [made.from, made.weight, made instanceof Span];
});
attempt("fill a stranger", () => {
  const stranger = { inner: { labels: new Set(["Base"]) } };
  Point.fillIn(stranger, { x: 5 });
  return [Object.keys(stranger), stranger.weight, stranger instanceof Base, stranger instanceof Point];
});

// A getter stands where the others have a value, and a value is defined twice.
const Lazy = makeKind("Lazy", (self, options) => {
  Object.defineProperty(self, "x", { get() { return options.x * 10; }, enumerable: true, configurable: true });
  Object.defineProperty(self, "weight", { value: 1, configurable: true });
  Object.defineProperty(self, "weight", { value: 2, enumerable: true, configurable: true, writable: true });
});
const lazy = new Lazy({ x: 3 });
show("lazy", [lazy.x, lazy.weight, Object.keys(lazy), Object.getOwnPropertyDescriptor(lazy, "weight"), typeof Object.getOwnPropertyDescriptor(lazy, "x").get]);
const all = [...mixed, lazy, late, early];
let total = 0;
for (let round = 0; round < 100; round++) for (const thing of all) total += (thing.x ?? 0) + thing.weight;
show("total", total);
shared.enumerable = true;
const seen = new Base({ weight: 1 });
show("descriptor changed", [Object.keys(seen), Object.getOwnPropertyDescriptor(seen, "inner").enumerable]);
shared.get = () => "got";
attempt("descriptor with getter and value", () => new Base({ weight: 1 }).inner);
delete shared.value;
attempt("descriptor with getter", () => new Base({ weight: 1 }));
console.log(lines.join("\n"));
