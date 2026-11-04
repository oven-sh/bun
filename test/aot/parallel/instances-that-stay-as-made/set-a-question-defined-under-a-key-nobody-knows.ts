// Set, a question: defined under a key nobody knows
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: Set<number>) { between(); return it.has(1); }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Set([1, 2, 3]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); const k: any = process.env.NO_SUCH_VARIABLE_OF_THIS_TEST ?? "has"; Object.defineProperty(other, k, { value: () => "mine", configurable: true });
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
