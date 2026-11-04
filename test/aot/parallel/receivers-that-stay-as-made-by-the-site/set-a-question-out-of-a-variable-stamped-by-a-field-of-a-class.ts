// Set, a question, out of a variable: stamped by a field of a class
let between = () => {};
let atEnd: () => unknown = () => "";
let at: any;
function ask() { const it: Set<number> = at; between(); return it.has(1); }
const seen: unknown[] = [];
function look(it: any) { at = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Set([1, 2, 3]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
class Handed { constructor(it: object) { return it; } }
class Stamps extends Handed { ["has"] = () => "mine"; }
const other: any = make(); new Stamps(other);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
