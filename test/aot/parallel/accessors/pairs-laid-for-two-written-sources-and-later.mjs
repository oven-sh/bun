// Pairs of accessors that one function makes for two written source keys, read and stored in loops. The receiver is what the pair was laid on, or is not; then what they reach changes.
const asked = [];
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
class Panel {
  constructor(values, sizes) {
    this.values = values;
    this.sizes = sizes;
    for (const name of Object.keys(values)) lay(this, "values", name);
    for (const name of Object.keys(sizes)) lay(this, "sizes", name);
  }
  grow(times) {
    for (let turn = 0; turn < times; turn++) {
      this.count += this.wide;
      this.wide = this.wide + (turn & 1);
      this.title = this.title.slice(-4) + turn;
      this.high = this.count & 15;
    }
    return this.count + this.high;
  }
}
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
  if (round % 8 === 0) console.log(round, all, sum(panels), panels[2].title);
}
const heir = Object.create(panels[0]);
heir.values = { count: 1000, title: "heir" };
console.log(heir.count, heir.wide, heir.grow(2), panels[0].count === heir.count, Object.keys(heir).join());
const other = { values: { count: 7 }, sizes: panels[1].sizes, seen: Object.getOwnPropertyDescriptor(panels[0], "count").get };
console.log(other.seen(), Reflect.get(panels[0], "count", other), Reflect.set(panels[0], "wide", 70, other), panels[1].wide);
panels[3].values = { title: "lost" };
console.log(panels[3].count, panels[3].grow(1), Object.keys(panels[3].values).join());
panels[4].sizes = null;
try {
  panels[4].grow(1);
} catch (error) {
  console.log(error.constructor.name, panels[4].count === panels[4].values.count);
}
panels[5].values = new Proxy({ count: 2, title: "p" }, { get(target, name) { asked.push(name); return target[name]; } });
console.log(panels[5].grow(2), asked.join());
Object.defineProperty(panels[2], "count", { value: 5, writable: true });
delete panels[2].wide;
panels[2].wide = 9;
console.log(panels[2].grow(3), panels[2].values.count === 5, sum(panels.slice(0, 3)));
Object.freeze(panels[1].values);
try {
  panels[1].grow(1);
} catch (error) {
  console.log(error.constructor.name);
}
