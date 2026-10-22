const held = [];
held.unshift(2.5);
held.unshift(1.5);
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
