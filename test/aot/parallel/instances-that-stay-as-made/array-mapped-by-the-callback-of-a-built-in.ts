// Array, mapped: by the callback of a built in
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: number[]) { between(); return it.map((x: number) => x + 1).length; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return [1, 2, 3, 4]; }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); [other].forEach((o: any) => { try { o["map"] = () => [1]; } catch {} });
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
