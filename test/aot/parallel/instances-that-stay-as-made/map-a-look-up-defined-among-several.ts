// Map, a look up: defined among several
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: Map<number, number>) { between(); return it.get(1); }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Map([[1, 2], [3, 4]]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); Object.defineProperties(other, { ["get"]: { value: () => "mine", configurable: true } });
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
