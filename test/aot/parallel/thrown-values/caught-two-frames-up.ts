// an object is thrown through a function that has no handler and is caught two frames up, where a text is stored into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
function deepest(s: Stop): never { throw s; }
function middle(s: Stop) { deepest(s); return "never"; }
function deed(s: Stop) { try { return middle(s); } catch (e) { (e as any).node = "text"; return "caught"; } }
const held = new Stop(1);
console.log(String(read(held)));
console.log(deed(held));
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); deed(next); console.log(String(read(next))); }
