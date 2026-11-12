"use strict";
class Box {
  constructor(i, open) {
    this.kept = i;
    if (open) Object.defineProperty(this, "tag", { value: i, enumerable: true });
    else Object.defineProperty(this, "tag", { value: -i });
  }
}
const all = []; for (let i = 0; i < 40; i++) all.push(new Box(i, i % 2 === 0));
let s = 0; for (let i = 0; i < all.length; i++) s += all[i].kept + all[i].tag;
console.log(s, all[3].tag, all[4].tag, Object.keys(all[3]).join(), Object.keys(all[4]).join(), process.argv[2]);
