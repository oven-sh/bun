// Float64Array, the length bounds a loop: its buffer shrinks below its end
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(view: Float64Array) { let total = 0; for (let i = 0; i < view.length; i++) total += view[i]; return total; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(ask(view)); } catch (error) { seen.push((error as Error).name); } }
function fresh() { const view = new Float64Array(4); for (let i = 0; i < 4; i++) view[i] = i + 1; return view; }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
const shrinks = new ArrayBuffer(8 * Float64Array.BYTES_PER_ELEMENT, { maxByteLength: 16 * Float64Array.BYTES_PER_ELEMENT });
const other: any = new Float64Array(shrinks, 0, 6); other[1] = 2; look(other); shrinks.resize(2 * Float64Array.BYTES_PER_ELEMENT);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
