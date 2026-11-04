// Array, laid end to end: an accessor is laid
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: number[]) { between(); return [0].concat(it).length; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); let reads = 0; Object.defineProperty(other, Symbol.isConcatSpreadable, { get() { reads++; return false; }, configurable: true }); atEnd = () => reads > 0;
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
