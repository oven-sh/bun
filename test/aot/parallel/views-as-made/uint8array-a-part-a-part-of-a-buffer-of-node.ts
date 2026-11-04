// Uint8Array, a part: a part of a buffer of node
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(view: Uint8Array) { return view.subarray(1).length; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(ask(view)); } catch (error) { seen.push((error as Error).name); } }
function fresh() { const view = new Uint8Array(4); for (let i = 0; i < 4; i++) view[i] = i + 1; return view; }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
const other: any = Buffer.from([1, 2, 3, 4, 5, 6]).subarray(2);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
