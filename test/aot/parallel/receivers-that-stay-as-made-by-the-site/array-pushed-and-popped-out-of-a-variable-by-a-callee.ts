// Array, pushed and popped, out of a variable: by a callee
let between = () => {};
let atEnd: () => unknown = () => "";
let at: any;
function ask() { const it: number[] = at; between(); it.push(9); return it.pop(); }
const seen: unknown[] = [];
function look(it: any) { at = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
function deed(o: any) { try { o["push"] = () => 0; } catch {} }
const other: any = make(); deed(other);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
