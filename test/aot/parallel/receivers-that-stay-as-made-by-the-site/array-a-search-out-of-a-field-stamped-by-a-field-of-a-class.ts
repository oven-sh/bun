// Array, a search, out of a field: stamped by a field of a class
let between = () => {};
let atEnd: () => unknown = () => "";
const place: { at: any } = { at: undefined };
function ask() { const it: number[] = place.at; between(); return it.indexOf(2); }
const seen: unknown[] = [];
function look(it: any) { place.at = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
class Handed { constructor(it: object) { return it; } }
class Stamps extends Handed { ["indexOf"] = () => "mine"; }
const other: any = make(); new Stamps(other);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
