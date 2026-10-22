const held = new Array(2).fill(7).with(1, 1.5);
let total = 0;
for (let index = 0; index < held.length; index++) total += held[index];
console.log(total);
