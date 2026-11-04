// an object is thrown by the then of a thenable that is awaited: the engine calls then in a job and rejects with what it throws, and the handler around the await stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
class Thenable { held: Stop; constructor(held: Stop) { this.held = held; } then(): void { throw this.held; } }
function read(s: Stop) { return s.node + 1; }
async function deed(t: Thenable) { try { await (t as any); } catch (e) { (e as any).node = "text"; } }
const held = new Stop(1);
console.log(String(read(held)));
await deed(new Thenable(held));
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); await deed(new Thenable(next)); console.log(String(read(next))); }
export {};
