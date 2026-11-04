// Array, joined: by reflect define
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: number[]) { between(); return it.join(""); }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); Reflect.defineProperty(other, "join", { value: () => "mine", configurable: true });
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
