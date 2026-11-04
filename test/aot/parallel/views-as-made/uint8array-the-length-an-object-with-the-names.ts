// Uint8Array, the length: an object with the names
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(view: Uint8Array) { return view.length; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(ask(view)); } catch (error) { seen.push((error as Error).name); } }
function fresh() { const view = new Uint8Array(4); for (let i = 0; i < 4; i++) view[i] = i + 1; return view; }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
const other: any = { length: 2, byteLength: 3, byteOffset: 4, 0: 5, 1: 6, buffer: { byteLength: 7 }, indexOf() { return "i"; }, at() { return "a"; }, join() { return "j"; }, subarray() { return "ab"; }, *[Symbol.iterator]() { yield 8; } };
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
