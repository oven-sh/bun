// an object is thrown by the function that replace calls for a match, and the handler around the call stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
function deed(s: Stop, text: string) { try { return text.replace(/b/, () => { throw s; }); } catch (e) { (e as any).node = "text"; return "caught"; } }
const held = new Stop(1);
console.log(String(read(held)));
console.log(deed(held, "aaa"));
console.log(String(read(held)));
console.log(deed(held, "abc"));
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); deed(next, "abc"); console.log(String(read(next))); }
