const held = [];
held[0] = 1.5;
held[1] = 2.5;
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
