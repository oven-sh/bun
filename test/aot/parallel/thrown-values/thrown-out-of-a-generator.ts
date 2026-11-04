// an object is thrown by the body of a generator, and whoever steps it under a handler stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
function* fails(s: Stop) { yield 1; throw s; }
function deed(s: Stop) { let seen = 0; try { for (const value of fails(s)) seen += value; } catch (e) { (e as any).node = "text" + seen; } }
const held = new Stop(1);
console.log(String(read(held)));
deed(held);
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); deed(next); console.log(String(read(next))); }
