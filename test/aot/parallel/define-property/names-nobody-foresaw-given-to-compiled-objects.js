// Compiled objects are given names that their layouts do not have: by key, by name, by definition; once, again in the same order, in another order, across awaits, with reads, deletions and listings in between.
const lines = [];
const show = (label, object) => {
  const parts = [];
  for (const key of Reflect.ownKeys(object)) {
    const d = Object.getOwnPropertyDescriptor(object, key);
    parts.push(String(key) + ":" + ("value" in d ? String(d.value) : "get=" + d.get?.call(object)) + (d.writable === false ? "r" : "") + (d.enumerable ? "" : "h") + (d.configurable ? "" : "f"));
  }
  const walked = [];
  for (const key in object) walked.push(key);
  lines.push(label + " | " + parts.join(" ") + " | " + walked.join() + " | " + Object.keys(object).join() + " | " + JSON.stringify(object));
};
function make(i) { return { id: i, kind: "k" + (i % 3) }; }
function fillByKey(object, prefix, count) { for (let i = 0; i < count; i++) object[prefix + i] = i; return object; }
function fillByDefinition(object, prefix, count) {
  for (let i = 0; i < count; i++) Object.defineProperty(object, prefix + i, { get: () => i * 2, enumerable: i % 2 === 0, configurable: true });
  return object;
}
function fillMixed(object, prefix, count) {
  for (let i = 0; i < count; i++) {
    if (i % 3 === 0) object[prefix + i] = i;
    else if (i % 3 === 1) Object.defineProperty(object, prefix + i, { value: i, writable: false, enumerable: true, configurable: false });
    else Object.defineProperty(object, prefix + i, { get() { return this.id + i; }, set(v) { this.id = v; }, enumerable: true, configurable: true });
  }
  return object;
}
for (const count of [1, 2, 3, 9, 70]) {
  for (let round = 0; round < 4; round++) show("key " + count + " " + round, fillByKey(make(round), "a", count > 9 ? 5 + count % 7 : count));
  for (let round = 0; round < 4; round++) show("definition " + count + " " + round, fillByDefinition(make(round), "b", count > 9 ? 5 + count % 7 : count));
  for (let round = 0; round < 4; round++) show("mixed " + count + " " + round, fillMixed(make(round), "c", count > 9 ? 5 + count % 7 : count));
}
const many = fillMixed(fillByDefinition(fillByKey(make(7), "x", 70), "y", 70), "z", 70);
lines.push("many " + Reflect.ownKeys(many).length + " " + Object.keys(many).length + " " + many.x69 + " " + many.y69 + " " + many.z68 + " " + Object.keys(many).slice(-3).join());
const again = fillMixed(fillByDefinition(fillByKey(make(8), "x", 70), "y", 70), "z", 70);
lines.push("again " + (Object.keys(again).join() === Object.keys(many).join()) + " " + again.z68);
const read = make(1);
for (let i = 0; i < 12; i++) { read["r" + i] = i; lines.push("read " + i + " " + read["r" + i] + " " + read.r0 + " " + ("r" + (i + 1) in read) + " " + Object.keys(read).length); }
const cut = fillByKey(make(2), "d", 10);
delete cut.d3; cut.d10 = 10; delete cut.id; cut.d3 = "back"; cut.id = "late"; delete cut.d0;
show("cut", cut);
const numbered = make(3);
numbered.b = 1; numbered[2] = "two"; numbered.a = 2; numbered[0] = "zero"; numbered["1"] = "one"; numbered[Symbol.for("s")] = "symbol"; numbered.c = 3;
show("numbered", numbered);
const sealed = fillByKey(make(4), "s", 4); Object.seal(sealed);
try { "use strict"; sealed.more = 1; } catch (e) { lines.push(e.constructor.name); }
show("sealed", sealed);
const frozen = Object.freeze(fillMixed(make(5), "f", 6));
try { Object.defineProperty(frozen, "g", { value: 1 }); } catch (e) { lines.push(e.constructor.name + " " + e.message); }
show("frozen", frozen);
const above = fillByKey(make(6), "p", 5);
const below = Object.create(above); below.own = 1; above.p5 = 5;
const inherited = []; for (const key in below) inherited.push(key);
lines.push("below " + inherited.join() + " " + below.p5 + " " + below.p0);
Object.defineProperty(above, "own", { set(v) { lines.push("setter " + v); }, configurable: true });
const second = Object.create(above); second.own = 2; lines.push("second " + Object.keys(second).length);
show("copy", { ...fillMixed(make(9), "m", 7) });
show("assign", Object.assign(make(10), fillByKey(make(11), "n", 6), { id: "over" }));
const { id, ...rest } = fillByKey(make(12), "q", 5); show("rest " + id, rest);
async function acrossAwaits() {
  const object = make(13);
  for (let i = 0; i < 8; i++) { object["w" + i] = i; if (i % 2) await null; Object.defineProperty(object, "v" + i, { get: () => i, enumerable: true, configurable: true }); }
  show("awaits", object);
  const next = make(14);
  for (let i = 0; i < 8; i++) { next["w" + i] = i; Object.defineProperty(next, "v" + i, { get: () => i, enumerable: true, configurable: true }); await null; }
  show("awaits again", next);
}
await acrossAwaits();
class Point { constructor(x) { this.x = x; } }
for (let round = 0; round < 3; round++) { const p = new Point(round); fillByKey(p, "t", 3); fillByDefinition(p, "u", 3); show("instance " + round, p); }
fillByKey(Point.prototype, "shared", 4);
lines.push("prototype " + new Point(1).shared3 + " " + Object.keys(Point.prototype).join());
console.log(lines.join("\n"));
