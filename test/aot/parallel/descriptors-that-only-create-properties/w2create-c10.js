"use strict";
function without(given) { const { other, ...rest } = given; Object.defineProperty(rest, "kept", { value: 5 }); return rest; }
const all = []; for (let i = 0; i < 40; i++) all.push(without({ kept: i, other: i * 2, name: "n" + i }));
let s = 0; for (let i = 0; i < all.length; i++) s += all[i].kept + all[i].name.length;
console.log(s, all[3].kept, Object.keys(all[3]).join(), process.argv[2]);
