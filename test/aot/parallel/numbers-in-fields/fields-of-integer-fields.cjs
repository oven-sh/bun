// Fields that sums with other fields fill, where unseen code stores what the sums don't show: fractions, wide numbers, strings, objects that run code.
const log = [];
function Clock(table) {
  this.step = 0;
  this.ticks = 0;
  this.total = 0;
  this.cost = 0;
  this.limit = 1000;
  this.table = table;
  this.handlers = [];
}
Clock.prototype.tune = function (n) {
  this.step = (n & 7) << 2;
};
Clock.prototype.restore = function (values) {
  let index = 0;
  this.step = values[index++];
  this.ticks = values[index++];
  this.total = values[index++];
  this.cost = values[index++];
};
Clock.prototype.run = function (turns) {
  for (let turn = 0; turn < turns; turn++) {
    this.handlers[turn % this.handlers.length](this, turn);
    this.ticks += this.step;
    this.total += this.ticks >> 1;
    this.cost += this.table[turn & 7];
    if (this.ticks > this.limit) {
      this.ticks -= this.limit;
      this.total -= this.ticks;
    }
  }
  return [this.step, this.ticks, this.total, this.cost].map(x => (Object.is(x, -0) ? "-0" : String(x))).join(" ");
};
globalThis.clocks = { Clock, store: (clock, name, value) => (clock[name] = value) };
const store = (0, eval)("(clock, name, value) => globalThis.clocks.store(clock, name, value)");
const noisy = name => ({ valueOf() { log.push(name); return 3; } });
const odd = [0.5, -0, NaN, 2 ** 31, 2 ** 40, -(2 ** 31), "7", "text", true, null, undefined, noisy("a"), noisy("b")];
const views = [new Uint8Array([1, 2, 3, 4, 5, 6, 7, 250]), new Uint32Array([1, 2 ** 32 - 1, 3, 4, 5, 6, 7, 8]), new Float64Array([0.5, 1, 2, 3, 4, 5, 6, 7]), [1, 2, "x", 3.5, , 6, 7, 8]];
for (const table of views) {
  const clock = new Clock(table);
  clock.tune(5);
  clock.handlers = [c => c.tune(3), () => {}];
  console.log(clock.run(40));
  for (const name of ["step", "ticks", "total", "cost"])
    for (const value of odd) {
      const other = new Clock(table);
      other.tune(5);
      other.handlers = [(c, turn) => turn === 3 && store(c, name, value), () => {}, (c, turn) => turn === 20 && c.tune(6)];
      let said;
      try {
        said = other.run(30);
      } catch (e) {
        said = e.constructor.name;
      }
      console.log(name, typeof value, said.slice(0, 120), log.splice(0).length);
    }
  const restored = new Clock(table);
  restored.restore([1.25, 2 ** 31 - 2, "5", -0]);
  restored.handlers = [() => {}];
  console.log(restored.run(9));
}
