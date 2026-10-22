const held = [];
held.unshift(1.5);
held.unshift(7);
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
