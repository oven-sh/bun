// Array, a search, out of a field: of a class below that adds nothing
let between = () => {};
let atEnd: () => unknown = () => "";
const place: { at: any } = { at: undefined };
function ask() { const it: number[] = place.at; between(); return it.indexOf(2); }
const seen: unknown[] = [];
function look(it: any) { place.at = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
class Below extends Array {}
const other: any = new Below(1, 2, 3, 4);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
