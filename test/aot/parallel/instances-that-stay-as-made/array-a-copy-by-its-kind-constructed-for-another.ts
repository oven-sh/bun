// Array, a copy by its kind: constructed for another
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: number[]) { between(); return it.slice(1) instanceof Array; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
function Other() {}
Other.prototype = { __proto__: Array.prototype, ["constructor"]: { [Symbol.species]: function () { return { length: 0 }; } } };
const other: any = Reflect.construct(Array, [1, 2, 3, 4], Other);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
