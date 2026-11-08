let work = 0;
function wrap(n) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return { weight: n, tag: "fresh" }; }
function spread(list) { for (let i = 0; i < 2; i++) work = (work + i) | 0; return list.flatMap(wrap); }
function total(list) { for (let i = 0; i < 2; i++) work = (work + i) | 0; let sum = 0; for (const each of list) sum += each.weight; return sum; }
const made = spread([1, 2, 3]);
made[1].weight = 40;
made[2].tag = 7;
console.log(total(made), made.map(each => typeof each.tag).join(), made.length);
