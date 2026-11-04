// Set, a question, out of a variable: by a callee
let between = () => {};
let atEnd: () => unknown = () => "";
let at: any;
function ask() { const it: Set<number> = at; between(); return it.has(1); }
const seen: unknown[] = [];
function look(it: any) { at = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Set([1, 2, 3]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
function deed(o: any) { try { o["has"] = () => "mine"; } catch {} }
const other: any = make(); deed(other);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
