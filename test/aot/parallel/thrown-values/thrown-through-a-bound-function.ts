// an object is thrown by a function that is entered through what bind has made, and the handler around that call stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
function walk(s: Stop): never { throw s; }
function deed(s: Stop) { const bound = walk.bind(undefined, s); try { bound(); } catch (e) { (e as any).node = "text"; } }
const held = new Stop(1);
console.log(String(read(held)));
deed(held);
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); deed(next); console.log(String(read(next))); }
