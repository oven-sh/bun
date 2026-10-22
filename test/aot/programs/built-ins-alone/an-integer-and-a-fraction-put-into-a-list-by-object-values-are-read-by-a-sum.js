const held = Object.values({ a: 7, b: 1.5 });
let total = 0;
for (let index = 0; index < held.length; index++) total += held[index];
console.log(total);
