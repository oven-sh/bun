// Array, a copy by its kind: through a field
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: number[]) { between(); return it.slice(1) instanceof Array; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); const holder: { it: any } = { it: other }; try { holder.it["constructor"] = { [Symbol.species]: function () { return { length: 0 }; } }; } catch {}
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
