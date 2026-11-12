// STATISTIC: HoldersReadIntoViews >= 2
// A method that fills a Buffer out of two holders under the same counter: Buffers, views, arrays, objects, nothing.
"use strict";
const own = a => a === null || a === undefined ? String(a) : a.length + ":" + Array.from(a, String).join();
let Filter = (module.exports = function (info, dependencies) { let width = info.width; let byteWidth = width * 3; this.read = dependencies.read; this.write = dependencies.write; this._images = []; this._images.push({ byteWidth: byteWidth, height: info.height, lineIndex: 0 }); this._index = 0; this._step = 3; });
Filter.prototype.start = function () { this.read(this._images[this._index].byteWidth + 1, this._reverse.bind(this)); };
Filter.prototype._sub = function (raw, line, n) { let step = this._step; let m = step - 1; let last = this._last; for (let x = 0; x < n; x++) { let a = raw[1 + x]; let b = last ? last[x] : 0; let c = x > m ? line[x - step] : 0; let d = x > m && last ? last[x - step] : 0; let e = pick(c, b, d); line[x] = a + e; } };
let pick; pick = function(left, above, upLeft) { let p = left + above - upLeft; let x = Math.abs(p - left); let y = Math.abs(p - above); let z = Math.abs(p - upLeft); if (x <= y && x <= z) { return left; } if (y <= z) { return above; } return upLeft; };

Filter.prototype._reverse = function (raw) { let kind = raw[0]; let line; let image = this._images[this._index]; let n = image.byteWidth; if (kind === 0) { line = raw.slice(1, n + 1); } else { line = Buffer.alloc(n); switch (kind) { case 1: this._sub(raw, line, n); break; default: throw new Error("kind"); } } this.write(line); image.lineIndex++; if (image.lineIndex >= image.height) { this._last = null; this._index++; image = this._images[this._index]; } else { this._last = line; } if (image) { this.read(image.byteWidth + 1, this._reverse.bind(this)); } else { this._last = null; this.complete(); } };
const base = new ArrayBuffer(40);
const makers = [n => Buffer.from(Array.from({ length: n }, (_, i) => i ? i * 37 & 255 : 1)), n => new Uint8Array(n).map((_, i) => i * 11 | 1), n => new Uint8Array(base, 2, n).fill(1), n => new Uint8Array(base, 4, n).fill(1), n => new Float64Array(n).map((_, i) => i * 1.5 || 1), n => new Int16Array(n).map((_, i) => i * -300 || 1), n => Array.from({ length: n }, (_, i) => i * 5 || 1), n => [1, 0.5, , 2], n => [], n => Buffer.alloc(n >> 1, 1), n => new BigInt64Array(n).fill(1n), n => ({ 0: 1, 1: 7, get 3() { return 9; } }), n => new Uint8ClampedArray(n).fill(1), n => [1, "a", "b", null, { valueOf() { return 4; } }], n => "1234567890123", n => null];
const queue = [];
const given = new Map([["w", 4], ["h", 40]]);
const out = [];
for (let k = 0; k < makers.length; k++) for (let l = 0; l < makers.length; l++) {
  const filter = new Filter({ width: given.get("w"), height: given.get("h") }, { read: (n, then) => queue.push([n, then]), write: line => out.push(own(line)) });
  filter._last = makers[l](12); filter.start();
  for (let turn = 0; turn < 3; turn++) { const [n, then] = queue.shift(); try { then(makers[k](13)); } catch (e) { out.push(e.constructor.name); break; } }
  queue.length = 0;
}
console.log(out.join("\n"));
