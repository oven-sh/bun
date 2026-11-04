// Float64Array, the bytes: its buffer shrinks and grows again
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(view: Float64Array) { return view.byteLength + ":" + view.byteOffset; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(ask(view)); } catch (error) { seen.push((error as Error).name); } }
function fresh() { const view = new Float64Array(4); for (let i = 0; i < 4; i++) view[i] = i + 1; return view; }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
const moves = new ArrayBuffer(8 * Float64Array.BYTES_PER_ELEMENT, { maxByteLength: 16 * Float64Array.BYTES_PER_ELEMENT });
const other: any = new Float64Array(moves, Float64Array.BYTES_PER_ELEMENT, 6); other[1] = 2; moves.resize(2 * Float64Array.BYTES_PER_ELEMENT); look(other); moves.resize(12 * Float64Array.BYTES_PER_ELEMENT);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
