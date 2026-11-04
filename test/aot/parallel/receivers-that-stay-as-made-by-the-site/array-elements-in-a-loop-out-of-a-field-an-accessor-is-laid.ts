// Array, elements in a loop, out of a field: an accessor is laid
let between = () => {};
let atEnd: () => unknown = () => "";
const place: { at: any } = { at: undefined };
function ask() { const it: number[] = place.at; between(); let all = ""; for (let i = 0; i < 4; i++) all += it[i]; return all; }
const seen: unknown[] = [];
function look(it: any) { place.at = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); let reads = 0; Object.defineProperty(other, 1, { get() { reads++; return "laid"; }, configurable: true }); atEnd = () => reads > 0;
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
