const held = new Array(2).fill(1.5).with(1, 2.5);
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
