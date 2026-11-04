// Uint8Array, the length is read twice: a constructor of its own
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(view: Uint8Array) { const inFront = view.length; between(); return inFront + ":" + view.length; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(ask(view)); } catch (error) { seen.push((error as Error).name); } }
function fresh() { const view = new Uint8Array(4); for (let i = 0; i < 4; i++) view[i] = i + 1; return view; }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
const other: any = fresh(); other.constructor = { [Symbol.species]: function (buffer: ArrayBuffer) { return new Uint8Array(buffer, 0, 1); } };
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
