// A base constructor hands `this` to helpers before the classes below have defined their fields. A read of such a field finds what the parents hold under the name, a store runs their setter: with an object that every later read finds complete.
function churn(depth) {
  const pair = { left: depth, right: -depth };
  const list = [depth, depth + 1, depth + 2];
  const read = () => pair.left + list[1];
  if (depth > 0) return churn(depth - 1) + read();
  Bun.gc(true);
  return read();
}
const kept = [];
const seen = [];
const report = () => kept.splice(0).map(k => k.tag + "/" + k.level).join("+") || "nobody";
const readLevel = thing => thing.level;
const raise = (thing, level) => {
  thing.level = level;
};
class ReadsEarly {
  constructor() {
    seen.push("early read " + readLevel(this));
  }
  get level() {
    kept.push(this);
    return "getter";
  }
  set level(value) {
    kept.push(this);
    seen.push("setter " + value);
  }
}
class StoresEarly extends ReadsEarly {
  constructor() {
    super();
    raise(this, "stored early");
  }
}
class Heir extends StoresEarly {
  level = 1;
  tag;
  constructor(tag) {
    super();
    this.tag = tag;
  }
}
const lines = [];
for (let i = 0; i < 3; i++) {
  const heir = new Heir("heir" + i);
  lines.push(readLevel(heir));
  raise(heir, 2 + i);
  lines.push(readLevel(heir), seen.splice(0).join("; "));
  churn(20);
  lines.push(report());
}
function local(i) {
  const heir = new Heir("local" + i);
  raise(heir, i);
  return readLevel(heir);
}
for (let i = 0; i < 3; i++) {
  lines.push(local(i), seen.splice(0).join("; "));
  churn(20);
  lines.push(report());
}
// A constructor function that calls out before it fills `this`, below a prototype with accessors.
function Late(tag) {
  seen.push("early read " + readLevel(this));
  raise(this, "early");
  Object.defineProperty(this, "level", { value: 7, writable: true, enumerable: true, configurable: true });
  this.tag = tag;
}
Late.prototype = Object.create(ReadsEarly.prototype);
for (let i = 0; i < 2; i++) {
  lines.push(readLevel(new Late("late" + i)), seen.splice(0).join("; "));
  churn(20);
  lines.push(report());
}
console.log(lines.join("\n"));
