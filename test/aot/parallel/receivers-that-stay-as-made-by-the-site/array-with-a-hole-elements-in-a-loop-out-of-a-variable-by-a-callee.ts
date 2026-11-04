// Array, elements in a loop, out of a variable: by a callee
let between = () => {};
let atEnd: () => unknown = () => "";
let at: any;
function ask() { const it: number[] = at; between(); let all = ""; for (let i = 0; i < 4; i++) all += it[i]; return all; }
const seen: unknown[] = [];
function look(it: any) { at = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, , 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
function deed(o: any) { try { o[1] = "laid"; } catch {} }
const other: any = make(); deed(other);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
