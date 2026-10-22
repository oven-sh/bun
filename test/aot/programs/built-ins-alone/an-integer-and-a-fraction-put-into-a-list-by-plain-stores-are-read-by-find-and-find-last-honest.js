const held = [];
held[0] = 7;
held[1] = 1.5;
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
