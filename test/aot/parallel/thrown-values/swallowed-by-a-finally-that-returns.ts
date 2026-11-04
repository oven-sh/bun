// an object is thrown under a finally that returns: nobody gets it, the handler further out never runs, and its number field stays a number
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
function swallows(s: Stop) { try { throw s; } finally { return "done"; } }
function deed(s: Stop) { try { return swallows(s); } catch (e) { (e as any).node = "text"; return "caught"; } }
const held = new Stop(1);
console.log(String(read(held)));
console.log(deed(held));
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); console.log(deed(next)); console.log(String(read(next))); }
