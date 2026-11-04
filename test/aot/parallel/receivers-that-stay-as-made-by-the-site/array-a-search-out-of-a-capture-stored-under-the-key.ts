// Array, a search, out of a capture: stored under the key
let between = () => {};
let atEnd: () => unknown = () => "";
const reader = (() => { let at: any; return { put(it: any) { at = it; }, ask() { const it: number[] = at; between(); return it.indexOf(2); } }; })();
function ask() { return reader.ask(); }
const seen: unknown[] = [];
function look(it: any) { reader.put(it); try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); try { other["indexOf"] = () => "mine"; } catch {}
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
