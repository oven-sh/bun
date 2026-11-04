// Array, spread: through a table
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: number[]) { between(); return [...it].length; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); const held = new Map<string, any>([["it", other]]); try { held.get("it")[Symbol.iterator] = function* () { yield 42; }; } catch {}
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
