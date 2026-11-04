// Uint8Array, the bytes: the one that was looked at gets a length and loses it
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(view: Uint8Array) { return view.byteLength + ":" + view.byteOffset; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(ask(view)); } catch (error) { seen.push((error as Error).name); } }
function fresh() { const view = new Uint8Array(4); for (let i = 0; i < 4; i++) view[i] = i + 1; return view; }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
const other: any = plain; Object.defineProperty(other, "length", { value: 2, configurable: true }); look(other); delete other.length;
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
