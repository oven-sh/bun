// `new` through `any`, with the prototype of the result compared afterwards.
// IR- other prototypes
// IR- = Construct v
// IR+ NewObjectWithShape
declare const console: any;
interface NodeLinks { flags: number; resolved: NodeLinks | undefined; depth: number; name: string | undefined }
function NodeLinks(this: NodeLinks) { this.flags = 0; this.resolved = undefined; this.depth = 1; this.name = undefined; }
let s = 0;
const all: NodeLinks[] = [];
for (let i = 0; i < 5_000_000; i++) { const l: NodeLinks = new (NodeLinks as any)(); l.flags = i & 3; s += l.flags + l.depth; if ((i & 1048575) === 0) all.push(l); }
console.log(s, all.length, Object.keys(all[0]).join(), Object.getPrototypeOf(all[0]) === NodeLinks.prototype);
export {};
