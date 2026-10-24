// `f.length` and `f.name` answer with what the function was written with until the program defines them anew, deletes them or hands the function to code that does.
const lines = [];
const say = (...parts) => lines.push(parts.join(" "));
function three(a, b, c) {}
function withDefault(a, b = 1, c) {}
function withRest(a, ...rest) {}
const arrow = (a, b) => a;
const named = function inner(a) {};
const holder = { method(a, b, c, d) {}, get got() { return 1; }, ["comp" + "uted"](a) {}, plain: function () {}, [Symbol.iterator]() {} };
async function later(a) {}
function* steps(a, b) {}
class Shape { constructor(a, b) {} static make(a) {} area(a, b, c) {} }
class Odd { static length = 9; static name = "odd"; }
class OddMethods { static name() { return "called"; } }
for (let round = 0; round < 2; round++) {
  say(three.length, three.name, withDefault.length, withRest.length, arrow.length, arrow.name, named.name, named.length);
  say(holder.method.length, holder.method.name, Object.getOwnPropertyDescriptor(holder, "got").get.name, holder.computed.name, holder.plain.name, holder[Symbol.iterator].name);
  say(later.length, later.name, steps.length, steps.name, Shape.length, Shape.name, Shape.make.length, Shape.make.name, Shape.prototype.area.length, Odd.length, Odd.name, typeof OddMethods.name);
  say(three.bind(null, 1).length, three.bind(null).name, arrow.bind(null, 1, 2, 3).length);
}
function redefined(a, b) {}
say(redefined.length, redefined.name);
Object.defineProperty(redefined, "length", { value: 40 });
Object.defineProperty(redefined, "name", { value: "other" });
say(redefined.length, redefined.name);
function deleted(a, b) {}
say(delete deleted.length, delete deleted.name, deleted.length, JSON.stringify(deleted.name), Object.hasOwn(deleted, "length"));
function stored(a) {}
try {
  stored.length = 5;
} catch (error) {
  say(error.name);
}
try {
  stored.name = "no";
} catch (error) {
  say(error.name);
}
say(stored.length, stored.name);
function below(a, b, c) {}
delete below.length;
Object.setPrototypeOf(below, { length: "inherited", name: "up" });
say(below.length, below.name);
function changedByKey(a) {}
const key = ["len", "gth"].join("");
Object.defineProperty(changedByKey, key, { value: 77 });
say(changedByKey.length);
function changedElsewhere(a) {}
const change = target => Object.defineProperty(target, "name", { get() { return "got"; } });
say(changedElsewhere.name);
change(changedElsewhere);
say(changedElsewhere.name);
function handedOut(a, b) {}
globalThis.taken = handedOut;
new Function("Object.defineProperty(taken, 'length', { value: 12 })")();
say(handedOut.length);
function made() { return function inner(a, b) {}; }
const first = made(), second = made();
Object.defineProperty(first, "length", { value: 1 });
say(first.length, second.length, first.name, second.name);
for (const called of [three, withDefault, withRest, arrow, named, holder.method, holder.computed, holder.plain, later, steps, redefined, deleted, stored, below, changedByKey, changedElsewhere, handedOut, first, second]) called(1, 2);
say(three.length, three.name, redefined.length, redefined.name, deleted.length, below.length, changedByKey.length, changedElsewhere.name, handedOut.length, first.length, second.length);
console.log(lines.join("\n"));
