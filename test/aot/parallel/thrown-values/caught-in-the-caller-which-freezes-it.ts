// an object is thrown and caught in the caller, which freezes it. Typed code then stores into its field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function bump(s: Stop) { try { s.node = s.node + 1; } catch (e) { return (e as Error).name + s.node; } return String(s.node); }
function walk(s: Stop): never { throw s; }
function deed(s: Stop) { try { walk(s); } catch (e) { Object.freeze(e); } }
const held = new Stop(1);
console.log(bump(held));
deed(held);
console.log(bump(held));
for (let i = 0; i < 3; i++) { const next = new Stop(i); console.log(bump(next)); deed(next); console.log(bump(next)); }
