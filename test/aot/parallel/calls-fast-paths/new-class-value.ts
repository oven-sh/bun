// `new` on a class expression stored in a `const` needs no call into the runtime, and an instance that only the loop itself reads is never allocated.
// IR- ^ .*= Construct v
// IRM= 0 = (NewObject|CreateThis) 
declare const console: any;
const Links = class { a = 1; b = 2; sum() { return this.a + this.b; } };
let s = 0;
let last: any;
for (let i = 0; i < 5_000_000; i++) { const l = new Links(); l.a = i & 7; s += l.sum(); last = l; }
console.log(s, last.a, last.b);
export {};
