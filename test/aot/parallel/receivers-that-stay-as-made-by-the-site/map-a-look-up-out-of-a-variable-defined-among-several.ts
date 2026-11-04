// Map, a look up, out of a variable: defined among several
let between = () => {};
let atEnd: () => unknown = () => "";
let at: any;
function ask() { const it: Map<number, number> = at; between(); return it.get(1); }
const seen: unknown[] = [];
function look(it: any) { at = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Map([[1, 2], [3, 4]]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); Object.defineProperties(other, { ["get"]: { value: () => "mine", configurable: true } });
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
