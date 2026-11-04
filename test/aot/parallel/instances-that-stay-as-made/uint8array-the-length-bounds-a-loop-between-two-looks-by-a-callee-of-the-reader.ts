// Uint8Array, the length bounds a loop: between two looks by a callee of the reader
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: Uint8Array) { between(); let total = 0; for (let i = 0; i < it.length; i++) total += it[i]; return total; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Uint8Array([1, 2, 3, 4]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); let turns = 0; between = () => { if (++turns === 3) Object.defineProperty(other, "length", { value: 2, configurable: true }); };
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
