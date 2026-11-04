// Int32Array, the length bounds a loop: its buffer shrinks and grows again
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(view: Int32Array) { let total = 0; for (let i = 0; i < view.length; i++) total += view[i]; return total; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(ask(view)); } catch (error) { seen.push((error as Error).name); } }
function fresh() { const view = new Int32Array(4); for (let i = 0; i < 4; i++) view[i] = i + 1; return view; }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
const moves = new ArrayBuffer(8 * Int32Array.BYTES_PER_ELEMENT, { maxByteLength: 16 * Int32Array.BYTES_PER_ELEMENT });
const other: any = new Int32Array(moves, Int32Array.BYTES_PER_ELEMENT, 6); other[1] = 2; moves.resize(2 * Int32Array.BYTES_PER_ELEMENT); look(other); moves.resize(12 * Int32Array.BYTES_PER_ELEMENT);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
