// Parameters that loops read by position are passed the views that fields hold, and other values at other calls.
function make(length, value, kind) {
  switch (kind) { case "uint8": var made = new Uint8Array(length); break; case "int32": var made = new Int32Array(length); break; case "float64": var made = new Float64Array(length); }
  for (var i = 0; i < length; i++) made[i] = value * i;
  return made;
}
function Machine(length) { this.memory = []; this.frame = null; this.start(length); }
Machine.prototype.start = function (length) { this.memory = make(length, 3, "uint8"); this.frame = make(length, 100000, "int32"); };
Machine.prototype.copy = function (from) { if (!from || !from.length) return []; var to = []; for (var i = 0; i < from.length; ++i) to[i] = from[i]; return to; };
Machine.prototype.sum = function (from, more) { var s = 0; for (var i = 0; i < from.length; i++) { s += from[i]; if (i === 2 && more) more(from, this); } return s; };
Machine.prototype.fill = function (to, n) { for (var i = 0; i < n; i++) to[i] = i * 50; return Array.prototype.join.call(to); };
Machine.prototype.state = function (more) { return [this.sum(this.memory, more), this.sum(this.frame, more), this.copy(this.memory).join(), this.fill(this.memory, 5), this.copy(this.memory).length].join(" "); };
function attempt(f) { try { return String(f()); } catch (error) { return error.constructor.name; }  }
const others = { array: () => [1, "2", , 3.5], text: () => "0123", like: () => ({ length: 3, 0: 1, 1: 2, 2: "3" }), number: () => 5, nothing: () => null, missing: () => undefined, float: () => new Float32Array([1.5, 2.5]), big: () => new BigInt64Array([1n, 2n]),
  arguments: (function () { return () => arguments; })(1, 2, 3), proxy: () => new Proxy([4, 5, 6], {}), clamped: () => new Uint8ClampedArray([1, 300]), buffer: () => Buffer.from("abc"), getter: () => ({ get length() { return 2; }, get 0() { return 7; }, 1: -0 }) };
const mores = { none: null, reset: (from, m) => { m.memory = []; }, detach: from => { if (ArrayBuffer.isView(from)) from.buffer.transfer(); }, write: from => { from[3] = 1.5; }, grow: from => { if (Array.isArray(from)) from.push(9); } };
for (const [m, more] of Object.entries(mores)) {
  for (const [o, other] of Object.entries(others)) {
    const machine = new Machine(9);
    console.log(m, o, attempt(() => machine.state(more)), attempt(() => machine.copy(other()).join()), attempt(() => machine.sum(other(), more)), attempt(() => machine.fill(other(), 4)), attempt(() => machine.state(more)));
  }
}
