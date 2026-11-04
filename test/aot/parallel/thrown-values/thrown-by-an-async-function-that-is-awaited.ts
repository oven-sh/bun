// an object is thrown by an async function, and whoever awaits it under a handler stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
async function fails(s: Stop) { await null; throw s; }
async function deed(s: Stop) { try { await fails(s); } catch (e) { (e as any).node = "text"; } }
const held = new Stop(1);
console.log(String(read(held)));
await deed(held);
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); await deed(next); console.log(String(read(next))); }
export {};
