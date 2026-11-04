// an object is thrown into a generator by throw(): the handler around the yield stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
function* waits() { try { yield 1; } catch (e) { (e as any).node = "text"; } return "done"; }
function deed(s: Stop) { const stepped = waits(); stepped.next(); return String(stepped.throw(s).value); }
const held = new Stop(1);
console.log(String(read(held)));
console.log(deed(held));
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); deed(next); console.log(String(read(next))); }
