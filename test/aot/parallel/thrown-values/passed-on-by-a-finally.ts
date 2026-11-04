// an object is thrown through a finally, which runs and lets it go on, and the handler further out stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
let cleaned = 0;
function read(s: Stop) { return s.node + 1; }
function cleans(s: Stop) { try { throw s; } finally { cleaned++; } }
function deed(s: Stop) { try { cleans(s); } catch (e) { (e as any).node = "text" + cleaned; } }
const held = new Stop(1);
console.log(String(read(held)));
deed(held);
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); deed(next); console.log(String(read(next))); }
