const held = Object.values({ a: 1.5, b: 2.5 });
held.sort((left, right) => left - right);
console.log(held[0] + 1, held[1] + 1);
