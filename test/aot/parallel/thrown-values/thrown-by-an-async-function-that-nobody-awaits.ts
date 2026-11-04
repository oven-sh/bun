// an object is thrown by an async function at once, nobody awaits the call, and a callback of catch stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
async function fails(s: Stop) { throw s; }
function change(e: any) { e.node = "text"; }
function deed(s: Stop) { return fails(s).catch(change); }
const held = new Stop(1);
console.log(String(read(held)));
const settled = deed(held);
console.log(String(read(held)));
await settled;
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); await deed(next); console.log(String(read(next))); }
export {};
