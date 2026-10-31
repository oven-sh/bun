// What a function that only hands `this` on constructs is read by slot.
// COUNT: arrivals = 0
function fillPoint(self, options) {
  self.x = options.x;
  self.y = options.y;
  self.hidden.weigh = () => self.x + self.y;
}
function Point(options) {
  Object.defineProperty(this, "hidden", { value: { options, labels: ["point"] }, enumerable: false });
  fillPoint(this, options);
}
const things = [];
for (let i = 0; i < 64; i++) things.push(new Point({ x: i, y: 2 }));
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
