// an object is thrown by the comparator of sort, through native code, and the handler around the call stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
function deed(s: Stop) { try { return [3, 1, 2].sort(() => { throw s; }).join(); } catch (e) { (e as any).node = "text"; return "caught"; } }
const held = new Stop(1);
console.log(String(read(held)));
console.log(deed(held));
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); deed(next); console.log(String(read(next))); }
