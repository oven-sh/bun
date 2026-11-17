// What handlers construct out of a list, a Map, a variable, a field and a conditional, while those change.
const lines = [];
function say(...a) { lines.push(a.join(" ")); }
class A { constructor(x) { this.x = x; } get() { return "A" + this.x; } }
class B { #p = 2; constructor(x) { this.x = x; this.y = 1; } get() { return "B" + this.x + this.#p; } }
class C extends A { constructor(x) { super(x + 1); this.z = new.target === C; } }
function D(x) { this.x = x; }
D.prototype.get = function () { return "D" + this.x; };
class E { constructor(x) { if (x === 2) return { get: () => "other" }; if (x === 3) throw new RangeError("three"); this.x = x; } get() { return "E" + this.x; } }
const rows = [A, B, C, D, E], byName = new Map([["a", A], ["b", B], ["e", E]]), record = { type: A, set(type) { this.type = type; } };
let held = A;
function hold(type) { held = type; }
function makerOf(type) { return function (i) { return new type(i); }; }
const handlers = Object.create(null), names = ["row", "name", "both", "held", "field", "first", "second"];
handlers[names[0]] = function (i) { return new rows[i % 5](i); };
handlers[names[1]] = function (i) { return new (byName.get("abe"[i % 3]))(i); };
handlers[names[2]] = function (i) { return new (i & 1 ? B : D)(i); };
handlers[names[3]] = function (i) { return new held(i); };
handlers[names[4]] = function (i) { return new record.type(i); };
handlers[names[5]] = makerOf(C);
handlers[names[6]] = makerOf(E);
for (let turn = 0; turn < 4; turn++) {
  for (let i = 0; i < 6; i++) {
    for (const name of names) {
      try { const made = handlers[name](i); say(turn, i, name, made.get(), Object.keys(made).join(), made instanceof A); } catch (e) { say(turn, i, name, e.constructor.name); }
    }
  }
  if (turn === 0) { hold(E); record.set(C); D.prototype = { get() { return "new" + this.x; } }; }
  if (turn === 1) { hold(() => 1); record.set(B.bind(null, 7)); rows[0] = class Late extends B { }; byName.set("a", new Proxy(D, {})); }
  if (turn === 2) { hold(Map); record.set(null); byName.delete("b"); rows[1] = 5; }
}
console.log(lines.join("\n"));
