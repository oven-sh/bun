// Int32Array, the length bounds a loop: its buffer is handed away
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(view: Int32Array) { let total = 0; for (let i = 0; i < view.length; i++) total += view[i]; return total; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(ask(view)); } catch (error) { seen.push((error as Error).name); } }
function fresh() { const view = new Int32Array(4); for (let i = 0; i < 4; i++) view[i] = i + 1; return view; }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
const other: any = fresh(); look(other); other.buffer.transfer();
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
