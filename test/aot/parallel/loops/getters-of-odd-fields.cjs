// A loop reads a field through a getter: other objects, heirs, getters laid anew, views that are let go of.
class File {
  constructor(view, mode) { this._data = view; }
  get data() { return this._data; }
  set data(view) { this._data = view; }
  swap() { for (let i = 0; i < Math.floor(this.data.byteLength / 8) * 8; i += 8) this.data.setFloat64(i, this.data.getFloat64(i, little), !little); }
}
const little = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
function contents(size) { const view = new Uint8Array(size); for (let i = 0; i < size; i++) view[i] = (i * 31) & 63; return new DataView(view.buffer); }
const files = new Map();
async function fill() { for (let k = 0; k < 4; k++) files.set('f' + k, new File(contents(64 + 8 * k + k))); }
function text(view) { let s = 0; for (let i = 0; i < view.byteLength; i++) s = (s * 31 + view.getUint8(i)) | 0; return s; }
async function main() {
  await fill();
  for (const [name, file] of files) { file.swap(); console.log(name, text(file._data)); file.swap(); console.log(text(file._data)); }
  const odd = new File(contents(40));
  odd._data = { byteLength: 24, n: 0, getFloat64(i, l) { this.n += i; return l ? 1 : 2; }, setFloat64(i, v, l) { this.n += v; if (i === 8) odd._data = contents(16); } };
  odd.swap(); console.log(text(odd._data));
  for (const bad of [null, undefined, 7, 'x', { byteLength: 8 }]) { odd._data = bad; try { odd.swap(); console.log('done'); } catch (e) { console.log(e.name); } }
  odd._data = contents(32); Object.defineProperty(odd._data, 'setFloat64', { value(i) { odd._data = contents(8); } }); odd.swap(); console.log(odd._data.byteLength);
  const detached = new File(contents(64)); Object.defineProperty(detached, 'data', { get() { return contents(16); } }); detached.swap(); console.log(text(detached._data));
  class Heir extends File { get data() { return super.data; } } const heir = new Heir(contents(24)); heir.swap(); console.log(text(heir._data));
  structuredClone(files.get('f2')._data.buffer, { transfer: [files.get('f2')._data.buffer] }); try { files.get('f2').swap(); console.log('swapped'); } catch (e) { console.log(e.name); }
}
main();
