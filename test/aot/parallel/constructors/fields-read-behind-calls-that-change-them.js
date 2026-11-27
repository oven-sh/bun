// Fields of an object that its constructor handed out half made are read in loops behind calls that replace, delete, freeze, redefine or box them.
function Machine(early) {
  this.ticks = 4;
  early(this);
  this.shift = 1; this.total = 0; this.name = "m"; this.ratio = 0.5; this.flag = false; this.list = [1, 2, 3];
  this.finish(early);
}
Machine.prototype.finish = function (early) { early(this); this.late = 7; };
Machine.prototype.run = function (step, n) {
  var out = [];
  for (var i = 0; i < n; i++) {
    step(this, i);
    this.total += this.ticks >> this.shift;
    this.flag = this.ticks > this.ratio;
    step(this, i + n);
    this.ticks = (this.ticks + 1) & 255;
    out.push(this.name + this.total + this.flag + this.ratio + this.late);
    if (this.list[this.shift] === 2) this.ratio *= 2;
  }
  return out.join();
};
const steps = {
  none: () => {},
  text: (m, i) => { if (i === 2) m.ticks = "9"; },
  double: (m, i) => { if (i === 2) m.ticks = 2.75; if (i === 8) m.shift = -0; },
  object: (m, i) => { if (i === 2) m.ticks = { valueOf() { m.shift = 2; return 40; } }; },
  deleted: (m, i) => { if (i === 2) delete m.ticks; if (i === 9) delete m.ratio; },
  again: (m, i) => { if (i === 2) { delete m.ticks; m.ticks = 60; } },
  accessor: (m, i) => { if (i === 2) Object.defineProperty(m, "ticks", { configurable: true, get() { return 33; }, set(v) { this.total += v; } }); },
  frozen: (m, i) => { if (i === 8) Object.freeze(m); },
  sealed: (m, i) => { if (i === 2) Object.seal(m); },
  readonly: (m, i) => { if (i === 2) Object.defineProperty(m, "total", { writable: false }); },
  prototype: (m, i) => { if (i === 2) Object.setPrototypeOf(m, { late: 1, run: 2 }); },
  nothing: (m, i) => { if (i === 2) m.list = null; if (i === 3) m.list = [0, 2]; },
  undefined: (m, i) => { if (i === 2) m.ticks = undefined; },
  bigint: (m, i) => { if (i === 9) m.ticks = 5n; },
  added: (m, i) => { m["x" + i] = i; },
};
const earlies = { none: () => {}, read: m => { m.seen = m.shift; }, write: m => { m.shift = 3; m.late = "early"; }, remove: m => { delete m.ticks; }, keep: m => { globalThis.kept = m; } };
for (const [e, early] of Object.entries(earlies)) {
  for (const [s, step] of Object.entries(steps)) {
    const line = [];
    for (let round = 0; round < 3; round++) {
      try { line.push(new Machine(early).run(step, 6)); } catch (error) { line.push(error.constructor.name); }
    }
    console.log(e, s, line.join(" | "));
  }
}
