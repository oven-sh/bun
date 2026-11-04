// RegExp, a replacement: by reflect define
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: RegExp) { between(); it.lastIndex = 0; return "abab".replace(it, "x"); }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new RegExp("a(b)", "g"); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); Reflect.defineProperty(other, "exec", { value: () => null, configurable: true });
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
