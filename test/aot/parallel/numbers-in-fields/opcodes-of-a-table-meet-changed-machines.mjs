function Machine(rom, early) {
  this.pc = 0; this.a = 1; this.b = 2; this.flag = false; this.ticks = 0; this.total = 0;
  if (early) early(this);
  this.memory = rom; this.halted = 0; this.shift = 1; this.level = 0.5; this.delay = 0; this.limit = 60;
}
Machine.prototype.ops = [
  function (m) { m.a = (m.a + m.b) & 0xff; m.flag = m.a == 0; },
  function (m) { m.b = (m.b ^ m.a) & 0xff; m.total += m.b >> m.shift; },
  function (m) { if (m.flag) m.pc = (m.pc + 3) & 0xf; else m.a = (m.a << 1) & 0xff; },
  function (m) { m.ticks += 4; --m.delay; },
  function (m) { m.level = m.level * 1.5 % 7; m.total -= m.limit; },
  function (m) { m.memory[m.pc] = (m.a ^ m.b) & 7; },
];
Machine.prototype.readers = [function (m, at) { return m.memory[at]; }, function (m, at) { return m.memory[at] ^ (m.memory[at] & 1); }];
Machine.prototype.run = function (turns) {
  var op = 0, spent = 0;
  while (this.halted == 0) {
    if (this.delay > 0) this.delay = 0;
    op = this.readers[this.pc & 1](this, this.pc);
    this.pc = (this.pc + 1) & 0xf;
    this.ops[op % 6](this);
    spent = this.ticks >> this.shift;
    this.total += spent;
    if (this.total >= this.limit) this.total -= this.limit;
    this.ticks += 1;
    if (--turns <= 0) break;
  }
  return this.show();
};
Machine.prototype.show = function () { return Object.keys(this).map(key => this[key] && typeof this[key] === "object" ? this[key].length : Object.is(this[key], -0) ? "-0" : String(this[key])).join(); };
globalThis.seen = [Machine, findValue("machine")];
const rom = () => Uint8Array.of(0, 1, 2, 3, 4, 5, 1, 1, 3, 4, 2, 0, 5, 3, 1, 4);
const plain = new Machine(rom());
for (let i = 0; i < 60; i++) plain.run(40);
console.log(plain.run(50));
const attempt = (name, change, turns = 25) => {
  const machine = new Machine(rom());
  machine.run(7);
  let said;
  try { change(machine); said = machine.run(turns); } catch (error) { said = error.constructor.name; }
  let after; try { after = machine.show(); } catch (error) { after = error.constructor.name; }
  console.log(name, said, after);
};
attempt("frozen", Object.freeze);
attempt("sealed", Object.seal);
attempt("closed", Object.preventExtensions);
attempt("text", m => { m.b = "2"; });
attempt("big", m => { m.total = 5n; });
attempt("double", m => { m.total = 0.25; m.ticks = 2 ** 31 - 3; });
attempt("large", m => { m.ticks = 2147483645; m.total = 2147483640; m.limit = 4294967296; });
attempt("minus", m => { m.total = -0; m.limit = NaN; });
attempt("undefined", m => { m.shift = undefined; m.level = null; });
attempt("deleted", m => { delete m.delay; delete m.flag; });
attempt("deleted memory", m => { delete m.memory; });
attempt("getter", m => { let reads = 0; Object.defineProperty(m, "ticks", { get() { return ++reads; }, set(value) { m.seen = value; }, enumerable: true, configurable: true }); });
attempt("read only", m => Object.defineProperty(m, "total", { value: 3, writable: false }));
attempt("other memory", m => { m.memory = [5, 4, 3, 2, 1, 0, , 1, "2", 3]; });
attempt("float memory", m => { m.memory = Float64Array.of(1, 2.5, 3, 4, 5, 0, 1, 2, 3); });
attempt("other tables", m => { m.ops = [m.ops[1], m.ops[0], m.ops[3], m.ops[2], function (x) { x.halted = 1; }, m.ops[4]]; });
attempt("holes", m => { m.ops = [m.ops[1], , m.ops[3]]; });
attempt("proxy", m => { m.readers = [new Proxy(m.readers[0], {}), m.readers[1]]; });
attempt("bound", m => { m.ops = m.ops.map(op => op.bind(null)); });
attempt("extra", m => { for (let i = 0; i < 40; i++) m["extra" + i] = i; });
const half = [];
new Machine(rom(), m => { for (const op of Machine.prototype.ops) { try { op(m); half.push(m.show()); } catch (error) { half.push(error.constructor.name); } } try { half.push(m.run(3)); } catch (error) { half.push(error.constructor.name); } });
console.log(half.join(" "));
const record = { pc: 1, a: 2, b: 3, ticks: 4, total: 5, shift: 1, memory: [1, 2, 3], level: 1, limit: 2, delay: 3 };
for (let i = 0; i < 30; i++) Machine.prototype.ops.forEach(op => op(record));
console.log(JSON.stringify(record));
class Sub extends Machine { get extra() { return 1; } run(turns) { this.a ^= 1; return super.run(turns); } }
console.log(new Sub(rom()).run(40), Machine.prototype.ops.map(op => { try { return op(undefined); } catch (error) { return error.constructor.name; } }).join());
function findValue(name) { return globalThis[name]; }
