// Map, spread: another prototype by reflect
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: Map<number, number>) { between(); return [...it].length; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Map([[1, 2], [3, 4]]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); Reflect.setPrototypeOf(other, { __proto__: Map.prototype, [Symbol.iterator]: function* () { yield 42; } });
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
