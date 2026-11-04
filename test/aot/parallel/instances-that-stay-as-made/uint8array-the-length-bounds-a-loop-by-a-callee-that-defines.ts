// Uint8Array, the length bounds a loop: by a callee that defines
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: Uint8Array) { between(); let total = 0; for (let i = 0; i < it.length; i++) total += it[i]; return total; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Uint8Array([1, 2, 3, 4]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
function deed(o: any, k: any) { Object.defineProperty(o, k, { value: 2, configurable: true }); }
const other: any = make(); deed(other, "length");
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
