// Array, the last: constructed for another
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: number[]) { between(); return it.at(-1); }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
function Other() {}
Other.prototype = { __proto__: Array.prototype, ["at"]: () => "mine" };
const other: any = Reflect.construct(Array, [1, 2, 3, 4], Other);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
