// an object is thrown by a function that is entered through Function.prototype.call, and the handler around that call stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
function walk(this: Stop): never { throw this; }
function deed(s: Stop) { try { walk.call(s); } catch (e) { (e as any).node = "text"; } }
const held = new Stop(1);
console.log(String(read(held)));
deed(held);
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); deed(next); console.log(String(read(next))); }
