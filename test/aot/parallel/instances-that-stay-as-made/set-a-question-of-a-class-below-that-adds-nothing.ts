// Set, a question: of a class below that adds nothing
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: Set<number>) { between(); return it.has(1); }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Set([1, 2, 3]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
class Below extends Set {}
const other: any = new Below([1, 2, 3]);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
