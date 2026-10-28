// `new (F as any)()` on a constructor function with a typed `this`: the object is allocated at the call site together with its initial field stores.
// IR- ^ .*= Construct v
// IR+ : =?L[0-9]+ = (NewObject|CreateThis) 
declare const console: any;
interface NodeLinks { flags: number; resolved: NodeLinks | undefined; depth: number; name: string | undefined }
function NodeLinks(this: NodeLinks) { this.flags = 0; this.resolved = undefined; this.depth = 1; this.name = undefined; }
let s = 0;
const all: NodeLinks[] = [];
for (let i = 0; i < 5_000_000; i++) { const l: NodeLinks = new (NodeLinks as any)(); l.flags = i & 3; s += l.flags + l.depth; if ((i & 1048575) === 0) all.push(l); }
console.log(s, all.length, Object.keys(all[0]).join(), NodeLinks.prototype.isPrototypeOf(all[0]));
export {};
