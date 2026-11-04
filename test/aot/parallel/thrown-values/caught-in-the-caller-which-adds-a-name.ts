// an object is thrown and caught in the caller, which adds a name and deletes another
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; depth: number; constructor(node: number) { this.node = node; this.depth = 1; } }
function read(s: Stop) { return String(s.node) + String(s.depth) + Object.keys(s).join(); }
function walk(s: Stop): never { throw s; }
function deed(s: Stop) { try { walk(s); } catch (e) { (e as any).extra = "added"; delete (e as any).node; } }
const held = new Stop(1);
console.log(read(held));
deed(held);
console.log(read(held));
for (let i = 0; i < 3; i++) { const next = new Stop(i); console.log(read(next)); deed(next); console.log(read(next)); }
