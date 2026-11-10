// Each old object gets a young one and then an empty text. The VM marks that text whoever holds it, so its store runs no barrier, and the store in front may not leave its own barrier to it.
class Young { n: number; constructor(n: number) { this.n = n; } }
class Old { a: Young | null; b: string; constructor() { this.a = null; this.b = "x"; } }
const olds: Old[] = [];
for (let i = 0; i < 20000; i++) olds.push(new Old());
Bun.gc(true); Bun.gc(true);
function both(o: Old, n: number) { o.a = new Young(n); o.b = ""; }
for (let i = 0; i < olds.length; i++) both(olds[i], i);
let junk: number[][] = [];
for (let i = 0; i < 400000; i++) { junk.push([i, i + 1]); if (junk.length > 1000) junk = []; }
let wrong = 0;
for (let i = 0; i < olds.length; i++) if (olds[i].a!.n !== i) wrong++;
console.log(wrong, junk.length >= 0);
