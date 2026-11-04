// Array, elements in a loop, out of a list: another prototype by reflect
let between = () => {};
let atEnd: () => unknown = () => "";
const kept: any[] = [];
function ask() { const it: number[] = kept[0]; between(); let all = ""; for (let i = 0; i < 4; i++) all += it[i]; return all; }
const seen: unknown[] = [];
function look(it: any) { kept[0] = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); Reflect.setPrototypeOf(other, { __proto__: Array.prototype, [1]: "laid" });
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
