// two functions meet at one call, so nobody can say which is entered. One of them throws an object, and the handler around the call stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
function throws(s: Stop): string { throw s; }
function returns(s: Stop): string { return "returned" + s.node; }
const table: ((s: Stop) => string)[] = [returns, throws];
function deed(s: Stop, which: number) { const chosen = table[which]; try { return chosen(s); } catch (e) { (e as any).node = "text"; return "caught"; } }
const held = new Stop(1);
console.log(String(read(held)));
console.log(deed(held, 0));
console.log(String(read(held)));
console.log(deed(held, 1));
console.log(String(read(held)));
for (let i = 0; i < 4; i++) { const next = new Stop(i); console.log(deed(next, i & 1)); console.log(String(read(next))); }
