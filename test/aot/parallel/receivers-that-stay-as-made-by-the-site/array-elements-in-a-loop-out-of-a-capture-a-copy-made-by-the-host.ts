// Array, elements in a loop, out of a capture: a copy made by the host
let between = () => {};
let atEnd: () => unknown = () => "";
const reader = (() => { let at: any; return { put(it: any) { at = it; }, ask() { const it: number[] = at; between(); let all = ""; for (let i = 0; i < 4; i++) all += it[i]; return all; } }; })();
function ask() { return reader.ask(); }
const seen: unknown[] = [];
function look(it: any) { reader.put(it); try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = structuredClone(make()); try { other[1] = "laid"; } catch {}
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
