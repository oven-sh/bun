// Object.assign applies its sources in order and reads every getter exactly once, whatever kind of source comes after it.
const log = [];
function counted(label) {
  return { plain: label, get computed() { log.push("get " + label); return label + "!"; } };
}
function show(label, made) {
  log.push(label + " " + JSON.stringify(made) + " " + Reflect.ownKeys(made).map(String).join());
}
const proxied = new Proxy({ viaProxy: 1 }, { ownKeys(target) { log.push("ownKeys"); return Reflect.ownKeys(target); } });
const mark = Symbol("mark");
class Point { constructor(x, y) { this.x = x; this.y = y; } }
for (let round = 0; round < 4; round++) {
  show("text" + round, Object.assign({}, counted("a" + round), "xy"));
  show("proxy" + round, Object.assign({}, counted("b" + round), proxied));
  show("middle" + round, Object.assign({}, { first: round }, counted("c" + round), { last: round }));
  show("two" + round, Object.assign({}, counted("d" + round), counted("e" + round), [round]));
  show("created" + round, Object.assign(Object.create(Point.prototype), new Point(round, 2), counted("f" + round), "z"));
  show("record" + round, Object.assign(new Point(round, 0), counted("g" + round), "w"));
  show("skipped" + round, Object.assign({}, null, { kept: round }, undefined, 7, true, { [mark]: round }));
  show("later" + round, Object.assign({}, { a: 1, b: 2 }, { b: 3, c: 4 }, { a: 5, d: round }));
  const target = { own: 0 };
  show("self" + round, Object.assign(target, { own: round }, target, { more: 1 }));
}
const thrower = { get boom() { log.push("boom"); throw new RangeError("stop"); } };
for (let round = 0; round < 4; round++) {
  const target = {};
  try {
    Object.assign(target, { before: round }, thrower, { after: round });
  } catch (error) {
    show("threw " + error.name + round, target);
  }
}
console.log(log.join("\n"));
