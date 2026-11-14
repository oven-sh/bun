// STATISTIC: DataViewAccessesOfKnownLimit >= 2
// What a getter reads is seen alone. The loop whose call takes another read through the getter as an operand has its version all the same.
class File {
  constructor(view, permissions) { this._data = view; }
  get data() { return this._data; }
  set data(view) { this._data = view; }
  swapByteOrder() { for (let i = 0; i < Math.floor(this.data.byteLength / 8) * 8; i += 8) this.data.setFloat64(i, this.data.getFloat64(i, isLittleEndian), !isLittleEndian); }
  sum() { let s = 0; for (let i = 0; i < this.data.byteLength; i++) s = (s * 31 + this.data.getUint8(i)) | 0; console.log(s); }
}
function computeIsLittleEndian() { const buffer = new ArrayBuffer(4), words = new DataView(buffer); words.setUint32(0, 0x11223344, true); return new Uint8Array(buffer)[0] === 0x44; }
const isLittleEndian = computeIsLittleEndian();
function contents(size) { const buffer = new ArrayBuffer(size), bytes = new Uint8Array(buffer); for (let i = 0; i < size; i++) bytes[i] = (i * 31) & 63; return new DataView(buffer); }
class Directory {
  constructor() { this.structure = new Map(); }
  async addFile(name, file) { if (this.structure.get(name) instanceof File) throw new Error('there'); this.structure.set(name, file); return file; }
  async *forEachFile() { for (const [name, entry] of this.structure) { if (entry instanceof File) yield { name, entry }; else yield { name, entry: null }; } }
}
const directory = new Directory();
(async function () {
  for (let k = 0; k < 4; k++) await directory.addFile('f' + k, new File(contents(64 + 9 * k)));
  for (let turn = 0; turn < 2; turn++) for await (const { entry: file } of directory.forEachFile()) { file.swapByteOrder(); file.sum(); }
})();
