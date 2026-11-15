// Fields are filled with what a helper returns for a written string: views, and arrays where the helper's handler runs. They are copied to other fields, replaced, reset and detached.
var fails = false;
function make(length, value, kind) {
  try {
    if (fails) throw new Error("no views");
    switch (kind) {
      case "int8": var made = new Int8Array(length); break;
      case "uint8": var made = new Uint8Array(length); break;
      case "int32": var made = new Int32Array(length); break;
      case "float32": var made = new Float32Array(length);
    }
    if (value != 0) { var i = 0; while (i < length) made[i++] = value; }
  } catch (error) {
    var made = [];
    var i = 0;
    while (i < length) made[i++] = value;
  }
  return made;
}
function convert(from, kind) {
  if (!from || !from.length) return [];
  switch (kind) {
    case "uint8": var to = new Uint8Array(from.length); break;
    case "int32": var to = new Int32Array(from.length);
  }
  for (var i = 0; i < from.length; i++) to[i] = from[i];
  return to;
}
function Machine(length, kind) {
  this.memory = []; this.frame = []; this.noise = null; this.bank = null; this.palette = null; this.any = null; this.ticks = [4, 12, 8];
  this.start(length, kind);
}
Machine.prototype.start = function (length, kind) {
  this.memory = make(length, 0, "uint8"); this.frame = make(length, 7, "int32"); this.noise = make(length, 0, "int8"); this.palette = make(8, 1.5, "float32");
  this.any = make(length, 2, kind); this.bank = this.memory; this.ticks = convert(this.ticks, "uint8");
};
Machine.prototype.fill = function (n, event, at) { for (var i = 0; i < n; i++) { if (i === at) event(this); this.memory[i] = i * 37; this.noise[i] = i * 37; this.frame[i] = i * 100000; } return show(this.memory) + " " + show(this.noise) + " " + show(this.frame); };
Machine.prototype.sum = function (n, event, at) { var s = 0; for (var i = 0; i < n; i++) { if (i === at) event(this); s += this.bank[i] + this.palette[i & 7] + this.any[i] + this.ticks[i % 3]; } return s; };
Machine.prototype.step = function (n, event, at) { for (var i = 0; i < n; i++) { if (i === at) event(this); ++this.memory[5]; this.memory[6] = ((this.memory[6] << 1) & 0xfe) | 1; this.noise[i & 3] ^= 0xff; } return show(this.memory) + " " + show(this.noise); };
function show(v) { return v == null ? String(v) : v.constructor.name + ":" + Array.prototype.join.call(v); }
const events = {
  none: () => {}, array: m => { m.memory = [1.5, , "3", 4]; m.noise = [9]; }, other: m => { m.memory = new Float64Array(9); m.bank = new Uint16Array(4); },
  nothing: m => { m.noise = null; }, reset: m => { m.memory = []; m.frame = []; }, swap: m => { m.bank = m.frame; m.frame = m.memory; }, detach: m => { if (ArrayBuffer.isView(m.memory)) m.memory.buffer.transfer(); },
  text: m => { m.bank = "0123456789"; m.palette = "ab"; }, frozen: m => { Object.freeze(m); }, accessor: m => { Object.defineProperty(m, "memory", { get() { return [1, 2, 3, 4, 5, 6, 7]; } }); }, deleted: m => { delete m.any; },
};
for (const failing of [false, true]) {
  for (const kind of ["int8", "float32", "none", "uint" + 8]) {
    for (const [name, event] of Object.entries(events)) {
      const line = [];
      for (const use of ["fill", "sum", "step"]) {
        for (const at of [0, 4]) {
          fails = failing;
          try { line.push(new Machine(9, kind)[use](7, event, at)); } catch (error) { line.push(error.constructor.name); }
        }
      }
      console.log(failing, kind, name, line.join(" | "));
    }
  }
}
