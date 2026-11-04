// RegExp, a test, out of a variable: through a proxy
let between = () => {};
let atEnd: () => unknown = () => "";
let at: any;
function ask() { const it: RegExp = at; between(); it.lastIndex = 0; return it.test("ab"); }
const seen: unknown[] = [];
function look(it: any) { at = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return new RegExp("a(b)", "g"); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); Object.defineProperty(new Proxy(other, {}), "test", { value: () => "mine", configurable: true });
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
