globalThis.self = globalThis;
globalThis.global = globalThis;
const lines = [];
const tell = (...values) => lines.push(values.map(String).join(" "));

class Point {
  constructor(x) {
    this.x = x;
  }
}
class List {
  constructor() {
    this.points = [];
  }
  reserve(count) {
    for (let i = parseInt(this.points.length); i < count; i++) this.points[i] = new Point(i + 0.5);
  }
  sum() {
    let sum = 0;
    for (let i = 0; i < this.points.length; i++) sum += this.points[i].x;
    return sum;
  }
}
const list = new List();
list.reserve(4);
tell(self === globalThis, global === globalThis, globalThis.self.global === self, list.sum());

const store = (holder, name, value) => {
  const before = holder[name];
  holder[name] = value;
  return before;
};
const under = ["parse", "Int"].join("");
const original = store(self, under, text => (text === 4 ? 1 : 2));
tell(parseInt("12"), parseInt(4), globalThis.parseInt === self[under]);
list.reserve(6);
tell(list.points.length, list.sum());
store(globalThis, under, original);
tell(parseInt("12"), parseInt("0x1f", 16));

const named = [];
for (const name of ["self", "global"]) {
  store(globalThis, name, globalThis);
  named.push(globalThis[name] === globalThis);
}
tell(named.join());

globalThis.self = { points: 3 };
tell(self.points, typeof self.parseInt, globalThis.self === globalThis);
self.points++;
tell(globalThis.self.points);
globalThis.self = globalThis;
tell(self === globalThis, self.self.self === global);

self.added = new Point(7);
tell(added.x, globalThis.added === self.added, "added" in global);
added.x = "late";
tell(self.added.x, delete self.added, typeof added);

globalThis.self = globalThis;
const again = store(self, under, text => (text === "seven" ? 7 : 8));
tell(self === globalThis, parseInt("seven"), parseInt("12"));
self["parse" + "Float"] = () => "own";
tell(parseFloat("2.5"), globalThis.parseFloat());
store(self, under, again);
tell(parseInt("12"));

Object.defineProperty(globalThis, "self", {
  configurable: true,
  get() {
    return { own: "got" };
  },
  set(value) {
    tell("set", value === globalThis);
  },
});
globalThis.self = globalThis;
tell(self.own, globalThis.self === globalThis);
tell(list.sum());
console.log(lines.join("\n"));
