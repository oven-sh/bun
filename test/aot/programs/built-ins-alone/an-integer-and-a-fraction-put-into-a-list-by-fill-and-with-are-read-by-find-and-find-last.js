const held = new Array(2).fill(7).with(1, 1.5);
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
