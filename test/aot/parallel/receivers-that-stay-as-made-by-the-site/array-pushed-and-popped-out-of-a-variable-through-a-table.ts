// Array, pushed and popped, out of a variable: through a table
let between = () => {};
let atEnd: () => unknown = () => "";
let at: any;
function ask() { const it: number[] = at; between(); it.push(9); return it.pop(); }
const seen: unknown[] = [];
function look(it: any) { at = it; try { seen.push(String(ask())); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); const held = new Map<string, any>([["it", other]]); try { held.get("it")["push"] = () => 0; } catch {}
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
