// RegExp, a replacement: stored under a key nobody knows
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: RegExp) { between(); it.lastIndex = 0; return "abab".replace(it, "x"); }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new RegExp("a(b)", "g"); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); const k: any = process.env.NO_SUCH_VARIABLE_OF_THIS_TEST ?? "exec"; try { other[k] = () => null; } catch {}
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
