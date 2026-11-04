// Array, the last: the one that was looked at and taken away again
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: number[]) { between(); return it.at(-1); }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = plain; Object.defineProperty(other, "at", { value: () => "mine", configurable: true }); look(other); delete other["at"];
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
