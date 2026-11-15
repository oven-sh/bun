"use strict";
// `size` is a getter of the class; the descriptor creates an own `size` on some of its objects, which hides the getter there and nowhere else.
let asked = 0;
class Box { constructor(i) { this.kept = i; } get size() { asked++; return this.kept * 10; } set size(value) { this.kept = value; } }
function hide(object) { Object.defineProperty(object, "size", { value: -1 }); }
const all = [];
for (let i = 0; i < 30; i++) all.push(new Box(i));
function sum(list) { let s = 0; for (let i = 0; i < list.length; i++) s += list[i].size + list[i].kept; return s; }
console.log(sum(all), asked);
for (let i = 0; i < all.length; i += 3) hide(all[i]);
console.log(sum(all), asked, Object.getOwnPropertyNames(all[0]).join(), Object.getOwnPropertyNames(all[1]).join(), all[0].size, all[1].size);
try { all[0].size = 5; console.log("stored", all[0].size, all[0].kept); } catch (error) { console.log(error.name, all[0].size, all[0].kept); }
all[1].size = 5; console.log(all[1].size, all[1].kept, sum(all), asked);
