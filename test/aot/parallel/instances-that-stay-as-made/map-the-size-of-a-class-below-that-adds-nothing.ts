// Map, the size: of a class below that adds nothing
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: Map<number, number>) { between(); return it.size; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Map([[1, 2], [3, 4]]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
class Below extends Map {}
const other: any = new Below([[1, 2], [3, 4]]);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
