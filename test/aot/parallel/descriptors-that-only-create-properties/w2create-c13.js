"use strict";
class Base { constructor(n) { this.n = n; this.tag = n; } }
class Heir extends Base { other = 5; }
const all = []; for (let i = 0; i < 40; i++) all.push(new Base(i));
for (const one of all) Object.defineProperty(one, "tag", { value: 7 });
let s = 0; for (let i = 0; i < all.length; i++) s += all[i].n + all[i].tag;
console.log(s, new Heir(1).tag, Object.keys(all[3]).join(), process.argv[2]);
