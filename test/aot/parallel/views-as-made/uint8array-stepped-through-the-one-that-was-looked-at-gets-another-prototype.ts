// Uint8Array, stepped through: the one that was looked at gets another prototype
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(view: Uint8Array) { let total = 0; for (const element of view) total += element; return total; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(ask(view)); } catch (error) { seen.push((error as Error).name); } }
function fresh() { const view = new Uint8Array(4); for (let i = 0; i < 4; i++) view[i] = i + 1; return view; }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
const other: any = plain; Object.setPrototypeOf(other, { __proto__: Uint8Array.prototype, get length() { return 1; }, get byteLength() { return 5; }, join() { return "above"; } });
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
