// A field is removed from an object that has accessors of its own in place of other fields: the order of the keys behind it is as another such object got it.
"use strict";
const log = [];
class Plain { a = 1; b = "two"; c = 0.5; d = null; e = undefined; f = true; constructor(g) { this.g = g; } }
class Heir extends Plain { h = [1]; i = { j: 1 }; constructor(g) { super(g); this.k = "k"; } }
const literal = (g) => ({ a: 1, b: "two", c: 0.5, d: null, e: undefined, f: true, g });
const show = (object) => Object.keys(object).map((key) => key + "=" + JSON.stringify(object[key])).join() + " / " + Reflect.ownKeys(object).map(String).join();
const accessor = (key, listed = true) => ({ get: () => "got " + key, set: undefined, enumerable: listed, configurable: true });
function replace(object, key, listed) {
  const had = delete object[key];
  Object.defineProperty(object, key, accessor(key, listed));
  return had;
}
const orders = [["a", "b", "c"], ["c", "b", "a"], ["g", "a"], ["b", "e", "d", "f"], ["f", "a", "g", "c", "b", "e", "d"], ["d"], ["e", "g"]];
const makers = [(g) => new Plain(g), (g) => new Heir(g), literal, (g) => Object.assign(new Plain(g), { extra: 1 })];
let turns = 0;
for (let turn = 0; turn < 120; turn++) for (const order of orders) for (const make of makers) {
  turns++;
  const object = make(turn), results = [];
  for (const key of order) results.push(replace(object, key, turn % 2 === 0));
  if (turn < 4 || turn % 40 === 0) log.push(results.join() + " " + show(object));
  const rest = ["a", "b", "c", "d", "e", "f", "g"].filter((key) => !order.includes(key));
  for (const key of rest) { if (!delete object[key]) log.push("kept " + key); if (key in object) log.push("still " + key); }
  if (turn < 4 || turn % 40 === 0) log.push(show(object));
  for (const key of rest) object[key] = key + turn;
  for (const key of order) delete object[key];
  if (turn < 4 || turn % 40 === 0) log.push(show(object) + " " + rest.map((key) => delete object[key]).join() + " " + rest.map((key) => delete object[key]).join() + show(object));
}
// Keys that are no fields stand between the fields.
for (let turn = 0; turn < 40; turn++) {
  const object = new Plain(turn);
  object.x = 1; delete object.b; object.b = "again"; object.y = 2; delete object.a; object.a = "again"; object.z = 3;
  replace(object, "c"); replace(object, "x");
  delete object.b; delete object.y;
  object.b = 1; object.y = 1;
  if (turn % 13 === 0) log.push(show(object));
  delete object.d; delete object.z; delete object.a; object.z = 4; object.d = 5; object.a = 6;
  if (turn % 13 === 0) log.push(show(object));
}
// What may not be removed.
const attempt = (action) => { try { return String(action()); } catch (error) { return error.name + ": " + error.message; } };
for (const limit of [Object.freeze, Object.seal, Object.preventExtensions, (object) => Object.defineProperty(object, "b", { configurable: false })]) for (let turn = 0; turn < 6; turn++) {
  const object = new Plain(turn);
  replace(object, "a");
  limit(object);
  log.push(attempt(() => delete object.b) + attempt(() => delete object.a) + attempt(() => Reflect.deleteProperty(object, "c")) + show(object));
}
// A prototype loses fields that stand beside its accessors.
for (let turn = 0; turn < 6; turn++) {
  const above = new Plain(turn), below = Object.create(above);
  replace(above, "a");
  log.push(below.b + " " + attempt(() => delete above.b) + " " + below.b + " " + below.a + " " + attempt(() => delete above.a) + " " + below.a + " " + show(above));
}
console.log(turns, log.length);
console.log(log.join("\n"));
