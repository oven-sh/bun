// Array, a search, out of a list: the one that was looked at and taken away again
let between = () => {};
let atEnd: () => unknown = () => "";
const kept: any[] = [];
function ask() { const it: number[] = kept[0]; between(); return it.indexOf(2); }
const seen: unknown[] = [];
function look(it: any) { kept[0] = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = plain; Object.defineProperty(other, "indexOf", { value: () => "mine", configurable: true }); look(other); delete other["indexOf"];
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
