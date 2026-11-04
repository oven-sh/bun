// Set, spread: by a closure
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: Set<number>) { between(); return [...it].length; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Set([1, 2, 3]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); const deed = () => { try { other[Symbol.iterator] = function* () { yield 42; }; } catch {} }; deed();
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
