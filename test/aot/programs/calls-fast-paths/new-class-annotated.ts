// `new` on a class held in an annotated `const` or in a `let` that is assigned once: the class is known, its constructor is inlined, and an object that does not leave the loop is never made.
// IR- = Construct v
// IR- NewObjectWithShape
// IRM= 1 frame [0-9]+ = Integer 2$
// IRM= 1 frame [0-9]+ = Integer 3$
declare const console: any;
const Links: any = class { a = 1; b = 2; sum() { return this.a + this.b; } };
let Other: any = class { c = 3; };
let s = 0;
for (let i = 0; i < 3_000_000; i++) { const l = new Links(); l.a = i & 7; s += l.sum() + new Other().c; }
console.log(s);
export {};
