// RegExp, the flags: a name that hides nothing
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: RegExp) { between(); return it.flags; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new RegExp("a(b)", "g"); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); other.extraOfThisTest = 1;
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
