// Array, a copy by its kind: between two looks by a callee of the reader
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: number[]) { between(); return it.slice(1) instanceof Array; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); let turns = 0; between = () => { if (++turns === 3) Object.defineProperty(other, "constructor", { value: { [Symbol.species]: function () { return { length: 0 }; } }, configurable: true }); };
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
