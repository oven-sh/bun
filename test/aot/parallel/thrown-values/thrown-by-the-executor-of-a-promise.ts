// an object is thrown by the executor of new Promise: native code catches it and rejects with it, and the second callback of then stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
function deed(s: Stop) { return new Promise(() => { throw s; }).then(undefined, e => { e.node = "text"; }); }
const held = new Stop(1);
console.log(String(read(held)));
await deed(held);
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); await deed(next); console.log(String(read(next))); }
export {};
