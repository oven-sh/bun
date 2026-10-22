const held = [].concat(1.5, [2.5]);
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
