// Map, a look up, out of a field: as the receiver of a call
let between = () => {};
let atEnd: () => unknown = () => "";
const place: { at: any } = { at: undefined };
function ask() { const it: Map<number, number> = place.at; between(); return it.get(1); }
const seen: unknown[] = [];
function look(it: any) { place.at = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Map([[1, 2], [3, 4]]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
function deed(this: any) { try { this["get"] = () => "mine"; } catch {} }
const other: any = make(); deed.call(other);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
