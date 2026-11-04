// Array, a search, out of a list: between two looks by a callee of the reader
let between = () => {};
let atEnd: () => unknown = () => "";
const kept: any[] = [];
function ask() { const it: number[] = kept[0]; between(); return it.indexOf(2); }
const seen: unknown[] = [];
function look(it: any) { kept[0] = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); let turns = 0; between = () => { if (++turns === 3) Object.defineProperty(other, "indexOf", { value: () => "mine", configurable: true }); };
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
