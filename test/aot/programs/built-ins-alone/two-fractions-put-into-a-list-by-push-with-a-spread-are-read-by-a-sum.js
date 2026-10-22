const held = [];
held.push(...[1.5, 2.5]);
let total = 0;
for (let index = 0; index < held.length; index++) total += held[index];
console.log(total);
