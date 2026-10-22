const held = Object.assign([], { 0: 1.5, 1: 2.5 });
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
