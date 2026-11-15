// A field that a loop reads several times: the names used off all of its reads say what it holds. It may hold something else, change in the loop, be detached, grow or throw.
const out = [];
class File {
  constructor(data) {
    this._data = data;
  }
  get data() {
    return this._data;
  }
  set data(data) {
    this._data = data;
  }
  swap(little) {
    let hash = 7;
    for (let index = 0; index < Math.floor(this.data.byteLength / 8) * 8; index += 8) {
      const value = this.data.getFloat64(index, little);
      this.data.setFloat64(index, value, !little);
      hash ^= value | 0;
    }
    return hash;
  }
  sum() {
    let sum = 0;
    for (let index = 0; index + 4 <= this._data.byteLength; index += 4) sum += this._data.getInt32(index) + this._data.byteOffset;
    return sum;
  }
  replace(other, at) {
    let sum = 0;
    for (let index = 0; index < this._data.byteLength; index += 8) {
      if (index === at) this._data = other;
      sum += this._data.getUint8(index);
    }
    return sum;
  }
  grow() {
    let count = 0;
    for (let index = 0; index < this.data.byteLength && count < 40; index += 8) {
      this.data.setInt8(index, count);
      if (index === 8 && this.data.buffer.resizable) this.data.buffer.resize(64);
      count++;
    }
    return count;
  }
  detach() {
    let count = 0;
    for (let index = 0; index < this.data.byteLength; index += 8) {
      this.data.setUint8(index, 1);
      if (index === 8) structuredClone(this.data.buffer, { transfer: [this.data.buffer] });
      count++;
    }
    return count;
  }
}
class Fake {
  constructor(length) {
    this.length = length;
    this.kept = new Map();
  }
  get byteLength() {
    return this.length;
  }
  get byteOffset() {
    return 2;
  }
  getFloat64(index) {
    return this.kept.get(index) ?? index / 2;
  }
  setFloat64(index, value) {
    this.kept.set(index, value + 1);
  }
  getInt32(index) {
    return index + 1;
  }
  getUint8(index) {
    return index & 7;
  }
  setUint8() {}
  setInt8() {}
  get buffer() {
    return { resizable: false };
  }
}
class Shorter extends DataView {
  get byteLength() {
    return super.byteLength - 8;
  }
}
function filled(view) {
  for (let index = 0; index < 32; index++) view.setUint8(index, index * 37);
  return view;
}
const makers = [
  () => filled(new DataView(new ArrayBuffer(40))),
  () => filled(new DataView(new ArrayBuffer(64), 8)),
  () => filled(new DataView(new ArrayBuffer(64), 8, 40)),
  () => filled(new DataView(new ArrayBuffer(40, { maxByteLength: 64 }))),
  () => filled(new DataView(new ArrayBuffer(48, { maxByteLength: 96 }), 8)),
  () => filled(new DataView(new SharedArrayBuffer(40))),
  () => new DataView(new ArrayBuffer(0)),
  () => filled(new Shorter(new ArrayBuffer(48))),
  () => filled(Object.assign(new DataView(new ArrayBuffer(40)), { extra: 1 })),
  () => Object.defineProperty(filled(new DataView(new ArrayBuffer(40))), "byteLength", { value: 24 }),
  () => new Fake(24),
  () => new Uint8Array(16),
  () => null,
  () => ({ byteLength: "16", byteOffset: 1, getFloat64: () => 2.5, setFloat64() {}, getInt32: () => 3, getUint8: () => 4, setUint8() {}, setInt8() {}, buffer: {} }),
];
for (const [number, make] of makers.entries()) {
  for (const run of [file => file.swap(true), file => file.swap(false) + "," + file.swap(true), file => file.sum(), file => file.replace(makers[0](), 16), file => file.replace(new Fake(40), 8), file => file.replace(undefined, 8), file => file.grow(), file => file.detach()]) {
    let result;
    try {
      result = run(new File(make()));
    } catch (error) {
      result = error.constructor.name + ": " + error.message;
    }
    out.push(number + " " + result);
  }
}
class Matcher {
  constructor(expression) {
    this.expression = expression;
  }
  count(text) {
    let found = "";
    for (let at = 0; at < text.length; at++) {
      this.expression.lastIndex = at;
      const match = this.expression.exec(text);
      if (match) found += match.index + ":" + this.expression.lastIndex + " ";
    }
    return found;
  }
}
for (const expression of [/b+/g, /a/y, /x/, { lastIndex: 0, exec() { return this.lastIndex % 2 ? { index: this.lastIndex } : null; } }]) out.push(new Matcher(expression).count("abbabab"));
console.log(out.join("\n"));
