// An object of the program becomes the global object of text that runs in another realm: the text declares, stores, deletes and redefines under the object's own names.
const vm = require("node:vm");
const lines = [];
const say = text => { lines.push(text); };
const show = value => (typeof value === "string" ? JSON.stringify(value) : typeof value === "function" ? "function" : String(value));
class Point {
  constructor(x, y) {
    this.x = x;
    this.y = y;
    this.label = "p";
  }
  sum() {
    return this.x + this.y;
  }
  tag() {
    return this.label + this.x;
  }
}
function look(label, p) {
  let text;
  try {
    text = show(p.x) + " " + show(p.y) + " " + show(p.label) + " " + show(p.sum()) + " " + show(p.tag()) + " " + ("x" in p) + " " + Object.keys(p).join();
  } catch (error) {
    text = "threw " + error.name;
  }
  say(label + ": " + text);
}
const texts = [
  "x = 'text'",
  "delete x",
  "var added = 1",
  "Object.defineProperty(globalThis, 'y', { get() { return 40; }, configurable: true })",
  "label = 7",
  "delete label; label = 'again'",
  "Object.freeze(globalThis)",
  "Object.setPrototypeOf(globalThis, { sum() { return 'other sum'; }, x: 'inherited' })",
  "function sum() { return 'own sum'; }",
  "this.y = { valueOf() { return 2; } }",
  "for (let i = 0; i < 70; i++) globalThis['n' + i] = i",
];
function permutations(count, length) {
  const all = [];
  for (let a = 0; a < count; a++) for (let b = 0; b < count; b++) if (a !== b) all.push(length === 2 ? [a, b] : [a]);
  return all;
}
for (const order of permutations(texts.length, 2)) {
  const p = new Point(1, 2);
  look("new", p);
  let context;
  try {
    context = vm.createContext(p);
  } catch (error) {
    say("no context " + error.name);
    continue;
  }
  for (const index of order) {
    try {
      vm.runInContext(texts[index], context);
    } catch (error) {
      say(index + " threw " + error.name);
    }
    look(order.join() + " behind " + index, p);
  }
  try {
    p.x = 5;
    p.y = 6;
    p.label = "q";
  } catch (error) {
    say("store threw " + error.name);
  }
  look(order.join() + " stored", p);
}
console.log(lines.join("\n"));
