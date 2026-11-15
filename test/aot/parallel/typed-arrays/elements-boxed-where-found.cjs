// STATISTIC: NumberElementsReadBoxed >= 8
// Elements of views that are stored boxed: each is boxed where it is found, what lies outside is undefined.
const note = (0, eval)("(holder => { if (holder.last === undefined) holder.seen++; })");
function Holder() {
  this.last = null;
  this.seen = 0;
}
Holder.prototype.bytes = function (view, from, turns) {
  const bytes = view instanceof Uint8Array ? view : new Uint8Array(1);
  for (let turn = 0; turn < turns; turn++) {
    this.last = bytes[from + turn];
    note(this);
  }
  return this.last;
};
Holder.prototype.signed = function (view, from, turns) {
  const bytes = view instanceof Int8Array ? view : new Int8Array(1);
  for (let turn = 0; turn < turns; turn++) {
    this.last = bytes[from - turn];
    note(this);
  }
  return this.last;
};
Holder.prototype.halves = function (view, from, turns) {
  const halves = view instanceof Uint16Array ? view : new Uint16Array(1);
  for (let turn = 0; turn < turns; turn++) {
    this.last = halves[(from + turn) | 0];
    note(this);
  }
  return this.last;
};
Holder.prototype.words = function (view, from, turns) {
  const words = view instanceof Uint32Array ? view : new Uint32Array(1);
  for (let turn = 0; turn < turns; turn++) {
    this.last = words[from + turn];
    note(this);
  }
  return this.last;
};
Holder.prototype.clamped = function (view, from, turns) {
  const bytes = view instanceof Uint8ClampedArray ? view : new Uint8ClampedArray(1);
  for (let turn = 0; turn < turns; turn++) {
    this.last = bytes[from + turn];
    note(this);
  }
  return this.last;
};
const unseen = (0, eval)("(holder, view) => { globalThis.held = [holder, view]; }");
const views = {
  bytes: [new Uint8Array([1, 2, 250, 255]), new Uint8Array(0), new Uint8Array(new ArrayBuffer(8, { maxByteLength: 16 }), 2)],
  signed: [new Int8Array([1, -2, 127, -128]), new Int8Array(0)],
  halves: [new Uint16Array([1, 2, 65535]), new Uint16Array(0)],
  words: [new Uint32Array([1, 2147483648, 4294967295]), new Uint32Array(0)],
  clamped: [new Uint8ClampedArray([1, 300, -5]), new Uint8ClampedArray(0)],
};
for (const name in views)
  for (const view of views[name])
    for (const from of [0, 1, 3, -1, -2, 2 ** 31 - 1, -(2 ** 31), 0.5, NaN])
      for (const turns of [0, 1, 4]) {
        const holder = new Holder();
        unseen(holder, view);
        console.log(name, view.length, from, turns, holder[name](view, from, turns), typeof holder.last, holder.seen);
      }
const lost = new Uint8Array([7, 8, 9]);
const holder = new Holder();
console.log(holder.bytes(lost, 1, 1));
lost.buffer.transfer();
console.log(holder.bytes(lost, 1, 1), holder.seen);
