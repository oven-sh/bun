// What such a function constructs keeps its slots where one shared descriptor defines a member, other closures of the factory fill it too, and a hook that nobody sees may get it.
// COUNT: arrivals <= 400
const shared = { value: undefined, enumerable: false };
function makeKind(label, fill) {
  function Inner(options) {
    this.options = options;
    this.maker = Kind;
    this.labels = new Set();
  }
  function fillIn(self, options) {
    if (!self.hidden) {
      shared.value = new Inner(options);
      try {
        Object.defineProperty(self, "hidden", shared);
      } finally {
        shared.value = undefined;
      }
    } else if (self.hidden.labels.has(label)) return;
    self.hidden.labels.add(label);
    fill(self, options);
  }
  function Kind(options) {
    fillIn(this, options);
    const hook = globalThis.hooksOfKinds?.made;
    if (hook) hook(this);
    return this;
  }
  Object.defineProperty(Kind, "fillIn", { value: fillIn });
  return Kind;
}
const Base = makeKind("base", (self, options) => {
  self.hidden.weigh = () => self.hidden.options.weight;
});
const Point = makeKind("point", (self, options) => {
  Base.fillIn(self, options);
  self.x = options.x;
  self.kind = "point";
});
const Span = makeKind("span", (self, options) => {
  Base.fillIn(self, options);
  self.from = options.from;
  self.kind = "span";
});
const things = [];
for (let i = 0; i < 64; i++) things.push(i & 1 ? new Point({ x: i, weight: 2 }) : new Span({ from: 1, weight: i }));
function total(list) {
  let sum = 0;
  for (const thing of list) sum += thing.hidden.weigh() + thing.hidden.labels.size + thing.kind.length;
  return sum;
}
let sum = 0;
for (let round = 0; round < 1000; round++) sum += total(things);
console.log(sum, Object.keys(things[1]).join(), JSON.stringify(Object.getOwnPropertyDescriptor(things[0], "hidden")).length);
