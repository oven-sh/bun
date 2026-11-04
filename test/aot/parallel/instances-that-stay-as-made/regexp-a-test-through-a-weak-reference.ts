// RegExp, a test: through a weak reference
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: RegExp) { between(); it.lastIndex = 0; return it.test("ab"); }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new RegExp("a(b)", "g"); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); try { new WeakRef<any>(other).deref()["test"] = () => "mine"; } catch {}
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
