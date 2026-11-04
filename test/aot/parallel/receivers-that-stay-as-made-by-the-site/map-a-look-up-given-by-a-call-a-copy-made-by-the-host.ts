// Map, a look up, given by a call: a copy made by the host
let between = () => {};
let atEnd: () => unknown = () => "";
let at: any;
function give() { return at; }
function ask() { const it: Map<number, number> = give(); between(); return it.get(1); }
const seen: unknown[] = [];
function look(it: any) { at = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Map([[1, 2], [3, 4]]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = structuredClone(make()); try { other["get"] = () => "mine"; } catch {}
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
