// Uint8Array, the buffer: its buffer grows
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(view: Uint8Array) { return view.buffer.byteLength; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(ask(view)); } catch (error) { seen.push((error as Error).name); } }
function fresh() { const view = new Uint8Array(4); for (let i = 0; i < 4; i++) view[i] = i + 1; return view; }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
const grows = new ArrayBuffer(4 * Uint8Array.BYTES_PER_ELEMENT, { maxByteLength: 16 * Uint8Array.BYTES_PER_ELEMENT });
const other: any = new Uint8Array(grows); other[1] = 2; look(other); grows.resize(8 * Uint8Array.BYTES_PER_ELEMENT);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
