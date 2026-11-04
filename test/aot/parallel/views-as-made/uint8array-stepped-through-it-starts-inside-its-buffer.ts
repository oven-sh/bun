// Uint8Array, stepped through: it starts inside its buffer
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(view: Uint8Array) { let total = 0; for (const element of view) total += element; return total; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(ask(view)); } catch (error) { seen.push((error as Error).name); } }
function fresh() { const view = new Uint8Array(4); for (let i = 0; i < 4; i++) view[i] = i + 1; return view; }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
const other: any = new Uint8Array(new ArrayBuffer(8 * Uint8Array.BYTES_PER_ELEMENT), 2 * Uint8Array.BYTES_PER_ELEMENT, 3); other[1] = 2;
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
