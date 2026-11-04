// Array, mapped: of a class below that answers itself
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: number[]) { between(); return it.map((x: number) => x + 1).length; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
class Below extends Array {}
Object.defineProperty(Below.prototype, "map", { value: () => [1], configurable: true });
const other: any = new Below(1, 2, 3, 4);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
