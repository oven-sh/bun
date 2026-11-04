// Array, pushed and popped, out of a variable: constructed for another
let between = () => {};
let atEnd: () => unknown = () => "";
let at: any;
function ask() { const it: number[] = at; between(); it.push(9); return it.pop(); }
const seen: unknown[] = [];
function look(it: any) { at = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
function Other() {}
Other.prototype = { __proto__: Array.prototype, ["push"]: () => 0 };
const other: any = Reflect.construct(Array, [1, 2, 3, 4], Other);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
