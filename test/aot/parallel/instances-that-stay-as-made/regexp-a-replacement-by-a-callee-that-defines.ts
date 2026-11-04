// RegExp, a replacement: by a callee that defines
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: RegExp) { between(); it.lastIndex = 0; return "abab".replace(it, "x"); }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new RegExp("a(b)", "g"); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
function deed(o: any, k: any) { Object.defineProperty(o, k, { value: () => null, configurable: true }); }
const other: any = make(); deed(other, "exec");
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
