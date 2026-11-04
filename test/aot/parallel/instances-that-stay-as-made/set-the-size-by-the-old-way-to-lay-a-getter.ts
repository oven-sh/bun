// Set, the size: by the old way to lay a getter
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: Set<number>) { between(); return it.size; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Set([1, 2, 3]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); other.__defineGetter__("size", () => (7));
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
