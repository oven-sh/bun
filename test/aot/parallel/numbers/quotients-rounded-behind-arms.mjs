// Math.floor, ceil, round, trunc and | 0 of quotients whose dividend is read through a getter in the line of the division.
class Holder {
  constructor(view) { this._view = view; }
  get view() { return this._view; }
  get count() { return this.view.byteLength; }
}
const views = [new DataView(new ArrayBuffer(0)), new DataView(new ArrayBuffer(1)), new DataView(new ArrayBuffer(7)), new DataView(new ArrayBuffer(8)), new DataView(new ArrayBuffer(9)), new DataView(new ArrayBuffer(1023)), new DataView(new ArrayBuffer(64), 8, 31)];
const odd = [{ byteLength: -1 }, { byteLength: -8 }, { byteLength: -9 }, { byteLength: 2 ** 31 }, { byteLength: 2 ** 32 + 5 }, { byteLength: 2 ** 53 }, { byteLength: 0.5 }, { byteLength: -0 }, { byteLength: NaN }, { byteLength: -0.5 }, { byteLength: "17" }, { byteLength: undefined }, { byteLength: Infinity }, { byteLength: { valueOf: () => 33 } }, new Uint8Array(13), new Uint16Array(13)];
const show = value => (Object.is(value, -0) ? "-0" : String(value));

function rounds(holder) {
  const out = [];
  for (let i = 0; i < Math.floor(holder.view.byteLength / 8) * 8; i += 8) { out.push(i); if (out.length > 4) break; }
  out.push(Math.floor(holder.view.byteLength / 8) * 8, Math.ceil(holder.view.byteLength / 8), Math.trunc(holder.view.byteLength / 8), Math.round(holder.view.byteLength / 8), (holder.view.byteLength / 8) | 0);
  out.push(Math.floor(holder.view.byteLength / 3), Math.floor(holder.view.byteLength / -4), (holder.view.byteLength / 5) | 0, Math.floor(holder.view.byteLength / 1), Math.floor(holder.count / 16), ~~(holder.count / 7), (holder.count / 2) >>> 0);
  return out.map(show).join();
}
function sum(holder) {
  let total = 0;
  for (let i = 0; i < Math.floor(holder.view.byteLength / 8) * 8; i += 8) {
    const read = holder.view.getFloat64(i, true);
    holder.view.setFloat64(i, read + i, false);
    total = (total + holder.view.getUint8(i)) | 0;
  }
  return total;
}
function quotient(a, b) { return Math.floor(a.n / b) + Math.trunc(a.n / b) * 1000 + ((a.n / b) | 0) * 1000000; }

const out = [];
for (let turn = 0; turn < 60; turn++) for (const view of views) { const holder = new Holder(view); const r = rounds(holder), s = sum(holder); if (turn === 59) out.push(r, s); }
for (const view of odd) { try { out.push(rounds(new Holder(view))); } catch (error) { out.push(String(error)); } }
for (let turn = 0; turn < 300; turn++) { const q = quotient({ n: turn * 7 - 900 }, (turn % 9) + 1); if (turn % 50 === 0) out.push(show(q)); }
for (const n of [-7, -1, 0, -0, 1, 7, 2 ** 31, -(2 ** 31), 2 ** 40 + 1, 0.5, NaN, "9", null]) for (const b of [1, 2, 8, -8, 0, 3]) out.push(show(quotient({ n }, b)));
console.log(out.join("\n"));
