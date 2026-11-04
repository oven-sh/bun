// Set, the size: of a class below that answers itself
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: Set<number>) { between(); return it.size; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Set([1, 2, 3]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
class Below extends Set {}
Object.defineProperty(Below.prototype, "size", { value: 7, configurable: true });
const other: any = new Below([1, 2, 3]);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
