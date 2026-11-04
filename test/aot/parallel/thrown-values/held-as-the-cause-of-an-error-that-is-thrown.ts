// an object is the cause of an error of the engine's own class. The error is thrown, and whoever catches it stores a text into the number field of the cause
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
function fails(s: Stop): never { throw new Error("failed", { cause: s }); }
function deed(s: Stop) { try { fails(s); } catch (e) { ((e as Error).cause as any).node = "text"; } }
const held = new Stop(1);
console.log(String(read(held)));
deed(held);
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); console.log(String(read(next))); deed(next); console.log(String(read(next))); }
