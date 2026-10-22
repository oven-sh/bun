const held = [];
held.unshift(1.5);
held.unshift(7);
let total = 0;
for (let index = 0; index < held.length; index++) total += held[index];
console.log(total);
