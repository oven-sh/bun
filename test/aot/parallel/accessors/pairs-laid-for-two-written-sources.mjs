// Pairs of accessors that one function makes for two written source keys, read and stored in loops.
// STATISTIC: AccessesDispatchedByKeyString >= 4
function lay(target, source, name) {
  Object.defineProperty(target, name, {
    configurable: true,
    enumerable: true,
    get() {
      return this[source][name];
    },
    set(value) {
      this[source][name] = value;
    },
  });
}
function Panel(values, sizes) {
  this.values = values;
  this.sizes = sizes;
  for (const name in values) lay(this, "values", name);
  for (const name in sizes) lay(this, "sizes", name);
}
Panel.prototype.grow = function (times) {
  for (let turn = 0; turn < times; turn++) {
    this.count += this.wide;
    this.wide = this.wide + (turn & 1);
    this.title = this.title.slice(-4) + turn;
    this.high = this.count & 15;
  }
  return this.count + this.high;
};
function sum(panels) {
  let all = 0;
  for (const panel of panels) all += panel.count * 2 + panel.wide + panel.high + panel.title.length;
  return all;
}
const panels = [];
for (let at = 0; at < 6; at++) panels.push(new Panel({ count: at, title: "t" + at }, { wide: at + 1, high: 3 }));
for (let round = 0; round < 25; round++) {
  let all = 0;
  for (const panel of panels) all += panel.grow(5);
  if (round % 8 === 0) console.log(round, all, sum(panels), panels[2].title, panels[2].values.title);
}
console.log(Object.keys(panels[1]).join(), panels[1].sizes.wide === panels[1].wide);
