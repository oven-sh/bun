// an object is thrown by a valueOf that an operator runs, with no call written, and the handler around the operator stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
class Converts { held: Stop; constructor(held: Stop) { this.held = held; } valueOf(): number { throw this.held; } }
function read(s: Stop) { return s.node + 1; }
function deed(c: Converts) { try { return String((c as any) * 2); } catch (e) { (e as any).node = "text"; return "caught"; } }
const held = new Stop(1);
console.log(String(read(held)));
console.log(deed(new Converts(held)));
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); deed(new Converts(next)); console.log(String(read(next))); }
