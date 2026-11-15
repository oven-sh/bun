// Loops of more than 100 operations store results of operators on numbers into elements of fields, which the loop itself or a setter may replace.
function Noise(size, make) { this.table = make(size); this.other = make(size); this.n = 0; }
Noise.prototype.fill = function (n, step) { var state = 0x7fff; for (var i = 0; i < n; ++i) { var factor = 1 - (state & 1); if (step && i === 5) step(this); this.table[1 * 16 | i] = factor * 1; this.table[2 * 16 | i] = factor * 2; this.other[24 + i] = (state & 510) / 2; this.table[4 * 16 | i] = factor * 4; this.table[5 * 16 | i] = factor * 5; this.other[48 + i] = (state & 1020) / 2; this.table[7 * 16 | i] = factor * 7; this.table[8 * 16 | i] = factor * 8; this.other[72 + i] = (state & 2040) / 2; this.table[10 * 16 | i] = factor * 10; this.table[11 * 16 | i] = factor * 11; this.other[96 + i] = (state & 4080) / 2; this.table[13 * 16 | i] = factor * 13; this.table[14 * 16 | i] = factor * 14; this.other[120 + i] = (state & 8160) / 2; var shifted = state >> 1; state = shifted | (((shifted ^ state) & 1) << 14); } return state; };
Noise.prototype.mix = function (n, step) { for (var i = 0; i < n; i++) { if (step && i === 5) step(this); this.table[i + 0] = this.other[i + 0] * 0 - this.n; this.table[i + 1] = this.other[i + 7] * 1 - this.n; this.table[i + 2] = this.other[i + 14] * 2 - this.n; this.table[i + 3] = this.other[i + 5] * 3 - this.n; this.table[i + 4] = this.other[i + 12] * 4 - this.n; this.table[i + 5] = this.other[i + 3] * 5 - this.n; this.table[i + 6] = this.other[i + 10] * 6 - this.n; this.table[i + 7] = this.other[i + 1] * 7 - this.n; this.table[i + 8] = this.other[i + 8] * 8 - this.n; this.table[i + 9] = this.other[i + 15] * 9 - this.n; this.table[i + 10] = this.other[i + 6] * 10 - this.n; this.table[i + 11] = this.other[i + 13] * 11 - this.n; this.table[i + 12] = this.other[i + 4] * 12 - this.n; this.table[i + 13] = this.other[i + 11] * 13 - this.n; this.table[i + 14] = this.other[i + 2] * 14 - this.n; this.table[i + 15] = this.other[i + 9] * 15 - this.n; } };
function show(v) { return v == null ? String(v) : typeof v === "string" ? v : Array.prototype.slice.call(v, 0, 40).join() + ":" + v.length; }
const makes = { int8: n => new Int8Array(n), uint8: n => new Uint8Array(n), clamped: n => new Uint8ClampedArray(n), int32: n => new Int32Array(n), float64: n => new Float64Array(n), short: n => new Int16Array(7), array: n => new Array(n).fill(0), empty: () => [], text: () => "abc", resizable: n => new Uint8Array(new ArrayBuffer(n, { maxByteLength: 2 * n })) };
const steps = { none: null, replace: h => { h.table = [1, 2, 3]; }, float: h => { h.other = new Float32Array(300); }, nothing: h => { h.table = null; }, detach: h => { if (ArrayBuffer.isView(h.table)) h.table.buffer.transfer(); },
  resize: h => { if (ArrayBuffer.isView(h.table) && h.table.buffer.resizable) h.table.buffer.resize(20); }, setter: h => { Object.defineProperty(h, "table", { configurable: true, get() { h.n++; return h.other; }, set() {} }); }, frozen: h => { Object.freeze(h); if (Array.isArray(h.table)) Object.freeze(h.table); }, same: h => { h.table = h.other; }, n: h => { h.n = 0.5; } };
for (const [m, make] of Object.entries(makes)) {
  for (const [s, step] of Object.entries(steps)) {
    const line = [];
    for (const use of ["fill", "mix"]) {
      const noise = new Noise(300, make);
      for (let k = 0; k < 8 && noise.other.length > k; k++) try { noise.other[k * 3] = k * 1.25; } catch {}
      try { line.push(noise[use](16, step)); } catch (error) { line.push(error.constructor.name); }
      line.push(show(noise.table), show(noise.other), noise.n);
    }
    console.log(m, s, line.join(" | "));
  }
}
