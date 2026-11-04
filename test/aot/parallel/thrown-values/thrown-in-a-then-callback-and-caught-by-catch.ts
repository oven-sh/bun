// an object is thrown in a callback of then: the promise keeps it as its reason, and the callback of catch stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
function read(s: Stop) { return s.node + 1; }
function deed(s: Stop) { return Promise.resolve(0).then(() => { throw s; }).catch(e => { e.node = "text"; }); }
const held = new Stop(1);
console.log(String(read(held)));
await deed(held);
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); await deed(next); console.log(String(read(next))); }
export {};
