// Code that the compiler does not see gets one instance and reaches its class through it: the prototype object, the class object, the class above. It changes what later constructions, stores, reads and calls find there. Every pair of changes, in both orders, by three kinds of unseen code.
const lines = [];
const say = text => { lines.push(text); };
const show = value => (typeof value === "string" ? JSON.stringify(value) : typeof value === "function" ? "function" : typeof value === "object" && value !== null ? "object" : String(value));
function define() {
  class Above {
    static shared = "shared";
    constructor() { this.first = 1; }
    hello() { return "hello above"; }
    get size() { return 10; }
  }
  class Thing extends Above {
    static count = 0;
    static label = "thing";
    static make(x) { Thing.count++; return new Thing(x); }
    constructor(x) {
      super();
      this.x = x;
      this.y = 2;
      this.late = undefined;
    }
    sum() { return this.x + this.y; }
    hello() { return "hello " + super.hello(); }
    setLate(v) { this.late = v; this.added = v; return this.late; }
  }
  return { Above, Thing };
}
const bodies = [
  "Object.defineProperty(Object.getPrototypeOf(o), 'x', { get() { return 'x above'; }, set(v) { log('setter x ' + v); }, configurable: true })",
  "Object.defineProperty(o.constructor.prototype, 'added', { set(v) { log('setter added ' + v); }, configurable: true })",
  "Object.defineProperty(o.__proto__.__proto__, 'first', { value: 'locked first', writable: false, configurable: true })",
  "o.constructor.prototype.sum = function () { return 'other sum'; }",
  "delete o.constructor.prototype.hello",
  "delete Object.getPrototypeOf(o.constructor.prototype).hello",
  "o.constructor.count = 'text'",
  "delete o.constructor.count",
  "Object.defineProperty(o.constructor, 'label', { get() { return 'label getter'; }, configurable: true })",
  "Object.freeze(o.constructor)",
  "Object.freeze(o.constructor.prototype)",
  "Object.setPrototypeOf(o.constructor.prototype, { hello() { return 'hello stranger'; }, get size() { return -1; } })",
  "Object.setPrototypeOf(o.constructor, { shared: 'shared stranger' })",
  "Object.getPrototypeOf(o.constructor).shared = 5",
  "Object.defineProperty(o.constructor.prototype, 'size', { value: 'own size', configurable: true })",
  "Object.defineProperty(o.constructor.prototype, 'late', { get() { return 'late above'; }, set(v) { log('setter late ' + show(v)); }, configurable: true })",
  "o.constructor.make = function (x) { return 'made by stranger ' + x; }",
  "Object.defineProperty(o.constructor.prototype, 'y', { value: 'y above', writable: false })",
];
const vm = require("node:vm");
const roads = [
  body => new Function("o", "log", "show", body),
  body => (0, eval)("(function (o, log, show) { " + body + " })"),
  body => vm.runInNewContext("(function (o, log, show) { " + body + " })"),
];
function look(label, Thing, Above, old) {
  let text = "";
  const tries = [
    () => show(old.x) + "," + show(old.y) + "," + show(old.first) + "," + show(old.late) + "," + show(old.sum()) + "," + show(old.size),
    () => show(old.hello()),
    () => { const made = new Thing(7); return show(made.x) + "," + show(made.y) + "," + show(made.first) + "," + show(made.late) + "," + Object.keys(made).join("+") + "," + show(made.sum()); },
    () => { const made = Thing.make(8); return show(made) + "," + show(made.x); },
    () => show(Thing.count) + "," + show(Thing.label) + "," + show(Thing.shared) + "," + show(Above.shared),
    () => { Thing.count = 3; Thing.label = "stored"; return show(Thing.count) + "," + show(Thing.label); },
    () => { old.x = 5; old.y = 6; return show(old.x) + "," + show(old.y); },
    () => show(old.setLate("late")) + "," + show(old.added) + "," + Object.keys(old).join("+"),
    () => show(new Above().first) + "," + show(new Above().hello()),
  ];
  for (const attempt of tries) {
    try {
      text += attempt() + " | ";
    } catch (error) {
      text += "threw " + error.name + " | ";
    }
  }
  say(label + ": " + text);
}
"use strict";
for (let road = 0; road < roads.length; road++) {
  for (let a = 0; a < bodies.length; a++) {
    for (let b = 0; b < bodies.length; b++) {
      if (a === b || (a * 7 + b + road) % 3) continue;
      const { Above, Thing } = define();
      const old = new Thing(1);
      if ((a + b) & 1) look("fresh", Thing, Above, old);
      for (const index of [a, b]) {
        try {
          roads[road](bodies[index])(old, say, show);
        } catch (error) {
          say(index + " threw " + error.name);
        }
        look(road + " " + a + "," + b + " behind " + index, Thing, Above, old);
      }
    }
  }
}
console.log(lines.join("\n"));
