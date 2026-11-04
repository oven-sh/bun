// Int32Array, the bytes: over shared memory that grows
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(view: Int32Array) { return view.byteLength + ":" + view.byteOffset; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(ask(view)); } catch (error) { seen.push((error as Error).name); } }
function fresh() { const view = new Int32Array(4); for (let i = 0; i < 4; i++) view[i] = i + 1; return view; }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
const shared = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT, { maxByteLength: 16 * Int32Array.BYTES_PER_ELEMENT });
const other: any = new Int32Array(shared); other[1] = 2; look(other); shared.grow(8 * Int32Array.BYTES_PER_ELEMENT);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
