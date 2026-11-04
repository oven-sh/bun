// Uint8Array, the bytes: nothing is done
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: Uint8Array) { between(); return it.byteLength; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Uint8Array([1, 2, 3, 4]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make();
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
