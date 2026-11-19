// an async function returns a thenable whose then throws an object: the promise of the function is rejected with it, and a callback of catch stores a text into its number field
// Under: --aot-testing=CheckProofsAtRunTime: the fields of a thrown object
class Stop { node: number; constructor(node: number) { this.node = node; } }
class Thenable { held: Stop; constructor(held: Stop) { this.held = held; } then(): void { throw this.held; } }
function read(s: Stop) { return s.node + 1; }
async function gives(t: Thenable): Promise<unknown> { return t as any; }
function deed(t: Thenable) { return gives(t).catch((e: any) => { e.node = "text"; }); }
const held = new Stop(1);
console.log(String(read(held)));
await deed(new Thenable(held));
console.log(String(read(held)));
for (let i = 0; i < 3; i++) { const next = new Stop(i); await deed(new Thenable(next)); console.log(String(read(next))); }
export {};
