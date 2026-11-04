// Uint8Array, the length: another prototype
let between = () => {};
let atEnd: () => unknown = () => "";
function ask(it: Uint8Array) { between(); return it.length; }
const seen: unknown[] = [];
function look(it: any) { try { seen.push(String(ask(it))); } catch (error) { seen.push((error as Error).name); } }
function make() { return new Uint8Array([1, 2, 3, 4]); }
const plain = make();
for (let i = 0; i < 3; i++) look(plain);
const other: any = make(); Object.setPrototypeOf(other, { __proto__: Uint8Array.prototype, ["length"]: 7 });
for (let i = 0; i < 3; i++) { look(other); look(plain); }
seen.push(atEnd());
console.log(seen.join());
