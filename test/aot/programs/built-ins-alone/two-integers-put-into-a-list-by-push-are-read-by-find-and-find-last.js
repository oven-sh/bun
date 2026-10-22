const held = [];
held.push(7);
held.push(8);
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
