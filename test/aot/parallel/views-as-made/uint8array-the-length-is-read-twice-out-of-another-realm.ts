// Uint8Array, the length is read twice: out of another realm
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(view: Uint8Array) { const inFront = view.length; between(); return inFront + ":" + view.length; }
const seen: unknown[] = [];
function look(view: any) { try { seen.push(ask(view)); } catch (error) { seen.push((error as Error).name); } }
function fresh() { const view = new Uint8Array(4); for (let i = 0; i < 4; i++) view[i] = i + 1; return view; }
const plain = fresh();
for (let i = 0; i < 3; i++) look(plain);
const other: any = (await import("node:vm")).runInNewContext("new Uint8Array([1, 2, 3])");
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
