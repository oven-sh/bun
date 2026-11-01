// What a function made at each call of a factory constructs, filled by code that the factory is handed and by Object.defineProperty, is read by slot.
// COUNT: arrivals = 0
function makeKind(label, fill) {
  function Kind(options) {
    Object.defineProperty(this, "hidden", { value: { options, labels: [label] }, enumerable: false });
    fill(this, options);
  }
  Object.defineProperty(Kind, "fill", { value: fill });
  return Kind;
}
const Point = makeKind("point", (self, options) => {
  self.x = options.x;
  self.y = options.y;
  self.hidden.weigh = () => self.x + self.y;
});
const Span = makeKind("span", (self, options) => {
  self.from = options.from;
  self.to = options.to;
  self.hidden.weigh = () => self.to - self.from;
});
const things = [];
for (let i = 0; i < 64; i++) things.push(i & 1 ? new Point({ x: i, y: 2 }) : new Span({ from: 1, to: i }));
function total(list) {
  let sum = 0;
  for (let i = 0; i < list.length; i++) sum += list[i].hidden.weigh() + list[i].hidden.labels.length;
  return sum;
}
let sum = 0;
for (let round = 0; round < 1000; round++) sum += total(things);
const point = new Point({ x: 3, y: 4 });
for (let round = 0; round < 1000; round++) sum += point.x * point.y + point.hidden.options.x;
console.log(sum, Object.keys(point).join(), JSON.stringify(Object.getOwnPropertyDescriptor(point, "hidden")).length);
