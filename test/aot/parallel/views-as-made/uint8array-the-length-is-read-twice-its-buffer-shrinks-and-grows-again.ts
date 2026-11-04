// Uint8Array, the length is read twice: its buffer shrinks and grows again
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(view: Uint8Array) { const inFront = view.length; between(); return inFront + ":" + view.length; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(ask(view)); } catch (error) { seen.push((error as Error).name); } }
function fresh() { const view = new Uint8Array(4); for (let i = 0; i < 4; i++) view[i] = i + 1; return view; }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
const moves = new ArrayBuffer(8 * Uint8Array.BYTES_PER_ELEMENT, { maxByteLength: 16 * Uint8Array.BYTES_PER_ELEMENT });
const other: any = new Uint8Array(moves, Uint8Array.BYTES_PER_ELEMENT, 6); other[1] = 2; moves.resize(2 * Uint8Array.BYTES_PER_ELEMENT); look(other); moves.resize(12 * Uint8Array.BYTES_PER_ELEMENT);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
