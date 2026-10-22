const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? 1.5 : 2.5));
console.log(held.find(() => true) + 1, held.findLast(() => true) + 1);
