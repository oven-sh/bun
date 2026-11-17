// A thousand objects of one shape pass one call, and the callee only reads and writes their fields. Then one of them gets an accessor under a field's name: by a descriptor, by a map of descriptors, by __defineGetter__, under a key that is computed far away. Its getter and setter keep `this`, so that object may lie in no frame.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
const report = () => kept.splice(0).map(k => k.tag + ":" + k.hidden).join("+") || "nobody";
function width(box) {
  return box.right - box.left;
}
function widen(box, by) {
  box.right = box.right + by;
  return box.right;
}
function spyOn(box, way, name) {
  const get = function () {
    kept.push(this);
    return this.hidden;
  };
  const set = function (value) {
    kept.push(this);
    this.hidden = value;
  };
  if (way === 0) Object.defineProperty(box, name, { get, set, configurable: true });
  else if (way === 1) Object.defineProperties(box, { [name]: { get, set } });
  else if (way === 2) Reflect.defineProperty(box, name, { get, set });
  else if (way === 3) {
    box.__defineGetter__(name, get);
    box.__defineSetter__(name, set);
  } else if (way === 4) Object.assign(box, Object.defineProperty({}, "tag", { value: box.tag + "!", enumerable: true }));
}
const names = ["ri" + "ght", ["l", "e", "f", "t"].join("")];
function measure(i, way, name) {
  const box = { left: i, right: i + 10, hidden: 100 + i, tag: "box" + i };
  if (way >= 0) spyOn(box, way, name);
  return width(box) + "," + widen(box, 1);
}
const lines = [];
let sum = 0;
for (let i = 0; i < 1000; i++) sum += Number(measure(i, -1, "").split(",")[0]);
lines.push(sum);
for (let way = 0; way < 5; way++) {
  for (const name of names) {
    lines.push(way + " " + name + " " + measure(way, way, name));
    churn(20);
    lines.push(report());
  }
}
class Box {
  constructor(i) {
    this.left = i;
    this.right = i + 10;
    this.hidden = 100 + i;
    this.tag = "Box" + i;
  }
}
function measureInstance(i, way, name) {
  const box = new Box(i);
  if (way >= 0) spyOn(box, way, name);
  return width(box) + "," + widen(box, 1);
}
for (let i = 0; i < 1000; i++) sum += Number(measureInstance(i, -1, "").split(",")[0]);
lines.push(sum);
for (let way = 0; way < 5; way++) {
  lines.push(way + " " + measureInstance(way, way, names[way & 1]));
  churn(20);
  lines.push(report());
}
console.log(lines.join("\n"));
