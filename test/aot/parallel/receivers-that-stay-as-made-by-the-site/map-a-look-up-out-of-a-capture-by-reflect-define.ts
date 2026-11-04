// Map, a look up, out of a capture: by reflect define
let between = () => {};
let atEnd: () => unknown = () => "";
const reader = (() => { let at: any; return { put(it: any) { at = it; }, ask() { const it: Map<number, number> = at; between(); return it.get(1); } }; })();
function ask() { return reader.ask(); }
const seen: unknown[] = [];
function look(it: any) { reader.put(it); try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Map([[1, 2], [3, 4]]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); Reflect.defineProperty(other, "get", { value: () => "mine", configurable: true });
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
