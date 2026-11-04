// an object is thrown by a getter of a class, and the handler around the read stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
class Holder { held: Stop; constructor(held: Stop) { this.held = held; } get bad(): number { throw this.held; } }
function read(s: Stop) { return s.node + 1; }
function deed(h: Holder) { try { return String(h.bad); } catch (e) { (e as any).node = "text"; return "caught"; } }
const held = new Stop(1);
console.log(String(read(held)));
console.log(deed(new Holder(held)));
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); deed(new Holder(next)); console.log(String(read(next))); }
