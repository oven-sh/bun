// Index loops over written lists of names, where an accessor or a method of Array.prototype changes the list first.
const log = [];
const attempt = f => {
  try {
    return f();
  } catch (error) {
    return error.constructor.name;
  }
};
const show = value => (typeof value === "function" ? "function " + attempt(() => value.call({ v: 2 }, 3)) : typeof value);
Object.defineProperty(Array.prototype, "grow", {
  get() {
    if (this.length < 3) this.push("added");
    return this.length;
  },
  configurable: true,
});
Object.defineProperty(Array.prototype, "rename", {
  get() {
    this[0] = "renamed";
    return this.length;
  },
  configurable: true,
});
function Box(v) {
  this.v = v;
}
function fillBox(key) {
  const names = ["first", "second"];
  log.push(names[key]);
  for (let i = 0; i < names.length; i++) {
    Box.prototype[names[i]] = function (x) {
      return this.v * x;
    };
  }
}
fillBox("grow");
class Point {
  constructor(v) {
    this.v = v;
  }
}
function fillPoint(target, names, key) {
  if (names[key]) log.push("yes");
  for (let i = 0; i < names.length; i++) {
    target[names[i]] = function (x) {
      return this.v + x;
    };
  }
}
fillPoint(Point.prototype, ["left", "right"], "rename");
const record = { v: 4 };
function fillRecord(key) {
  const names = ["one", "two"];
  for (let i = 0; i < names.length; i++) {
    log.push(names[key]);
    record[names[i]] = x => x + 1;
  }
}
fillRecord("grow");
const bare = Object.create(null);
bare.v = 1;
function fillBare() {
  const names = ["up", "down"];
  log.push(names[0], names[1], names[5]);
  for (let i = 0; i < names.length; i++) bare[names[i]] = x => x + 2;
}
fillBare();
const box = new Box(5);
const point = new Point(3);
function use() {
  return [box.first, box.added, point.left, point.renamed, point.right, record.one, record.added, bare.up, bare.added].map(show).join();
}
console.log(use());
console.log(use(), log.join());
console.log(Object.keys(Box.prototype).join(), Object.keys(Point.prototype).join(), Object.keys(record).join(), Object.keys(bare).join());
