// Map, a look up, out of a list: constructed for another
let between = () => {};
let atEnd: () => unknown = () => "";
const kept: any[] = [];
function ask() { const it: Map<number, number> = kept[0]; between(); return it.get(1); }
const seen: unknown[] = [];
function look(it: any) { kept[0] = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Map([[1, 2], [3, 4]]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
function Other() {}
Other.prototype = { __proto__: Map.prototype, ["get"]: () => "mine" };
const other: any = Reflect.construct(Map, [[[1, 2], [3, 4]]], Other);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
