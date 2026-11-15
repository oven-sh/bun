function Machine(rom) {
  this.pc = 0; this.a = 1; this.ticks = 0; this.rom = rom; this.halted = 0;
}
Machine.prototype.ops = [
  function (m) { m.a = (m.a * 3 + 1) & 0xff; },
  function (m) { m.a ^= 0x55; },
  function (m) { m.ticks += 2; },
  function (m) { m.hook(); },
];
Machine.prototype.costs = [1, 2, 3, 4];
Machine.prototype.limit = 1000;
Machine.prototype.hook = function () {};
Machine.prototype.run = function (turns) {
  var op = 0;
  while (this.halted == 0) {
    op = this.rom[this.pc & 7] & 3;
    this.pc = (this.pc + 1) & 0xffff;
    this.ticks += this.costs[op];
    this.ops[op](this);
    if (this.ticks > this.limit) this.ticks -= this.limit;
    if (--turns <= 0) break;
  }
  return this.a + "," + this.ticks + "," + this.pc;
};
globalThis.seen = [Machine];
const rom = [0, 1, 2, 3, 1, 0, 2, 2];
const tables = { ops: Machine.prototype.ops, costs: Machine.prototype.costs, limit: 1000, hook: Machine.prototype.hook };
const restore = () => {
  for (const key of Object.keys(tables)) Object.defineProperty(Machine.prototype, key, { value: tables[key], writable: true, enumerable: true, configurable: true });
  Object.setPrototypeOf(Machine.prototype, Object.prototype);
};
const plain = new Machine(rom);
for (let i = 0; i < 40; i++) plain.run(50);
console.log("plain", plain.run(50));
const attempt = (name, change, turns = 30) => {
  const machine = new Machine(rom);
  machine.run(9);
  let said;
  try { change(machine, Machine.prototype); said = machine.run(turns); } catch (error) { said = error.constructor.name; }
  const after = machine.a + "," + machine.ticks;
  restore();
  const other = new Machine(rom);
  console.log(name, said, after, other.run(20));
};
attempt("replaced", (m, p) => { p.costs = [9, 8, 7, 6]; });
attempt("replaced by a string", (m, p) => { p.costs = "1234"; });
attempt("replaced by undefined", (m, p) => { p.costs = undefined; });
attempt("number to text", (m, p) => { p.limit = "40"; });
attempt("deleted", (m, p) => { delete p.costs; });
attempt("deleted and laid above", (m, p) => { delete p.costs; Object.setPrototypeOf(p, { costs: [5, 5, 5, 5] }); });
attempt("own", m => { m.costs = [10, 20, 30, 40]; });
attempt("own ops", m => { m.ops = [m.ops[1], m.ops[1], m.ops[2], m.ops[0]]; });
attempt("accessor", (m, p) => { let reads = 0; Object.defineProperty(p, "costs", { get() { return [++reads, reads, 1, 1]; }, configurable: true }); });
attempt("accessor on the object", m => { let reads = 0; Object.defineProperty(m, "costs", { get() { return [++reads, 0, 1, reads]; }, configurable: true }); });
attempt("read only", (m, p) => { Object.defineProperty(p, "costs", { writable: false }); try { "use strict"; p.costs = [0]; } catch (error) { console.log(error.constructor.name); } });
attempt("frozen prototype", (m, p) => { p.costs = [3, 3, 3, 3]; });
attempt("other prototype of the object", m => Object.setPrototypeOf(m, { run: m.run, ops: tables.ops, costs: [7, 7, 7, 7], limit: 50, hook() {} }));
attempt("no prototype", m => { const run = m.run; Object.setPrototypeOf(m, null); m.run = run; });
attempt("prototype of the prototype", (m, p) => Object.setPrototypeOf(p, { costs: [0, 0, 0, 0], other: 1 }));
attempt("assign", (m, p) => { Object.assign(p, { costs: [2, 2, 2, 2], limit: 12 }); });
attempt("reflect", (m, p) => { Reflect.set(p, "costs", [4, 4, 4, 4]); });
attempt("define", (m, p) => { Reflect.defineProperty(p, "costs", { value: [6, 6, 6, 6] }); });
attempt("a computed key", (m, p) => { p["co" + (m.a > -1 ? "sts" : "")] = [8, 1, 8, 1]; });
let turn = 0;
attempt("changed within an iteration", (m, p) => { turn = 0; p.hook = function () { if (++turn == 3) p.costs = [11, 12, 13, 14]; }; }, 60);
attempt("deleted within an iteration", (m, p) => { turn = 0; p.hook = function () { if (++turn == 3) delete p.costs; }; }, 60);
attempt("own within an iteration", (m, p) => { turn = 0; p.hook = function () { if (++turn == 2) this.ops = [x => { x.a = 9; }, x => { x.a++; }, x => {}, x => {}]; }; }, 60);
attempt("ops replaced within an iteration", (m, p) => { turn = 0; p.hook = function () { if (++turn == 2) p.ops = [x => { x.a = 9; }, x => { x.a++; }, x => {}, x => { x.halted = 1; }]; }; }, 60);
attempt("a getter within an iteration", (m, p) => { turn = 0; p.hook = function () { if (++turn == 2) Object.defineProperty(p, "costs", { get() { return [1, 1, turn, 1]; }, configurable: true }); }; }, 60);
attempt("prototype within an iteration", (m, p) => { turn = 0; p.hook = function () { if (++turn == 2) Object.setPrototypeOf(this, { run: this.run, ops: tables.ops, costs: [0, 1, 0, 1], limit: 9, hook() {} }); }; }, 60);
class Derived extends Machine { get limit() { return 20; } }
const derived = new Derived(rom);
console.log("derived", derived.run(30), Object.keys(derived).length);
Derived.prototype.costs = [1, 0, 1, 0];
console.log("derived costs", new Derived(rom).run(30));
function Child(rom) { Machine.call(this, rom); }
Child.prototype = Object.create(Machine.prototype);
Child.prototype.costs = [0, 0, 0, 9];
console.log("child", new Child(rom).run(30));
delete Child.prototype.costs;
console.log("child behind a delete", new Child(rom).run(30));
const made = [1, 2].map(n => { function Made() { this.at = 0; this.sum = 0; } Made.prototype.list = [n, n * 2, n * 3]; Made.prototype.add = function () { for (let i = 0; i < 12; i++) this.sum += this.list[i % 3]; return this.sum; }; return new Made(); });
console.log(made.map(m => m.add()).join(), (made[0].list = [0, 0, 1], made.map(m => m.add()).join()));
const old = new Machine(rom);
Machine.prototype = { run: tables.ops && plain.run, ops: tables.ops, costs: [100, 100, 100, 100], limit: 1e6, hook() {} };
console.log("another prototype object", old.run(30), new Machine(rom).run(30), plain.run(10));
function Engine() { this.at = 0; this.sum = 0; this.on = 1; }
Engine.prototype.steps = [e => { e.sum += 1; }, e => { e.sum ^= 3; }, e => { e.tick(); }, e => { e.sum += e.at & 1; }];
Engine.prototype.weights = Uint8Array.of(1, 2, 3, 4);
Engine.prototype.label = "ab";
Engine.prototype.tick = function () {};
Engine.prototype.run = function (turns) {
  while (this.on == 1 && turns-- > 0) {
    const step = this.at & 3;
    this.steps[step](this);
    this.sum = (this.sum + this.weights[step] * this.label.length) & 0xffff;
    this.at = (this.at + 1) | 0;
  }
  return this.sum + "," + this.at;
};
globalThis.seenEngine = [Engine];
const engineParts = { steps: Engine.prototype.steps, weights: Engine.prototype.weights, label: "ab", tick: Engine.prototype.tick };
const warm = new Engine();
for (let i = 0; i < 40; i++) warm.run(50);
console.log("engine", warm.run(5));
const tryEngine = (name, change, turns = 40) => {
  const engine = new Engine(), prototype = Engine.prototype;
  engine.run(10);
  let said, count = 0;
  prototype.tick = function () { if (++count == 3) change(prototype, this); };
  try { said = engine.run(turns); } catch (error) { said = error.constructor.name + engine.at; }
  Object.setPrototypeOf(prototype, Object.prototype);
  Object.assign(prototype, engineParts);
  console.log(name, said, new Engine().run(20));
};
tryEngine("steps", p => { p.steps = [e => { e.sum += 7; }, e => {}, e => {}, e => { e.on = 2; }]; });
tryEngine("steps with a hole", p => { p.steps = [p.steps[0], , p.steps[3], p.steps[1]]; });
tryEngine("steps gone", p => { delete p.steps; });
tryEngine("steps above", p => { const steps = p.steps; delete p.steps; Object.setPrototypeOf(p, { steps: [steps[1], steps[0], steps[3], steps[0]] }); });
tryEngine("weights", p => { p.weights = Float64Array.of(0.5, 1.5, 2.5, 3.5); });
tryEngine("weights as an array", p => { p.weights = [9, , "3", 1]; });
tryEngine("weights undefined", p => { p.weights = undefined; });
tryEngine("label", p => { p.label = "abcdef"; });
tryEngine("label as an array", p => { p.label = [1, 2, 3]; });
tryEngine("label as a number", p => { p.label = 5; });
tryEngine("label by assign", p => { Object.assign(p, { label: "abc", weights: Uint8Array.of(9, 9, 9, 9) }); });
tryEngine("label by a computed key", p => { for (const key of ["la" + "bel"]) p[key] = "x".repeat(9); });
tryEngine("label by Reflect", p => { Reflect.set(p, "label", "0123456"); });
tryEngine("label behind a delete", p => { delete p.label; p.label = "q"; });
tryEngine("another prototype of the object", (p, e) => { Object.setPrototypeOf(e, { run: p.run, steps: p.steps, weights: [1, 1, 1, 1], label: "z", tick() {} }); });
