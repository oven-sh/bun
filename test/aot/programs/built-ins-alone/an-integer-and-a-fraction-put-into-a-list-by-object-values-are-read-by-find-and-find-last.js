const held = Object.values({ a: 7, b: 1.5 });
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
