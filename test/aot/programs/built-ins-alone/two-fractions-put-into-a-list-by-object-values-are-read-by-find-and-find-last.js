const held = Object.values({ a: 1.5, b: 2.5 });
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
