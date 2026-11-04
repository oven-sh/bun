// Set, a question, out of a variable: by code out of sight
let between = () => {};
let atEnd: () => unknown = () => "";
let at: any;
function ask() { const it: Set<number> = at; between(); return it.has(1); }
const seen: unknown[] = [];
function look(it: any) { at = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Set([1, 2, 3]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); (globalThis as any).deeds = [(o: any) => { try { o["has"] = () => "mine"; } catch {} }]; (globalThis as any).deeds[0](other);
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
