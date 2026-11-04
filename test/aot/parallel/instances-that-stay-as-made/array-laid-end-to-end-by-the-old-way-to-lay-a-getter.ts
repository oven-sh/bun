// Array, laid end to end: by the old way to lay a getter
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: number[]) { between(); return [0].concat(it).length; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); other.__defineGetter__(Symbol.isConcatSpreadable, () => (false));
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
