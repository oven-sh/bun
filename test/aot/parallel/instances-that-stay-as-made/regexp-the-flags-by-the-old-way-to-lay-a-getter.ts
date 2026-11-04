// RegExp, the flags: by the old way to lay a getter
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: RegExp) { between(); return it.flags; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new RegExp("a(b)", "g"); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); other.__defineGetter__("flags", () => ("y"));
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
