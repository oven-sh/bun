// Set, spread: through a list
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: Set<number>) { between(); return [...it].length; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Set([1, 2, 3]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); const held: any[] = [other]; try { held[0][Symbol.iterator] = function* () { yield 42; }; } catch {}
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
