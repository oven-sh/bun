// Set, spread: as the receiver of a bound function
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: Set<number>) { between(); return [...it].length; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Set([1, 2, 3]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
function deed(this: any) { try { this[Symbol.iterator] = function* () { yield 42; }; } catch {} }
const other: any = make(); deed.bind(other)();
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
