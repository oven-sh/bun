const held = Array.from({ length: 2, 0: 7, 1: 1.5 });
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
