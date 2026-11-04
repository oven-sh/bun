// Array, a search, given by a call: by a callee that defines
let between = () => {};
let atEnd: () => unknown = () => "";
let at: any;
function give() { return at; }
function ask() { const it: number[] = give(); between(); return it.indexOf(2); }
const seen: unknown[] = [];
function look(it: any) { at = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
function deed(o: any, k: any) { Object.defineProperty(o, k, { value: () => "mine", configurable: true }); }
const other: any = make(); deed(other, "indexOf");
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
