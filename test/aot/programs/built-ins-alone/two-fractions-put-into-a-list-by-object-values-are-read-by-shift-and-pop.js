const held = Object.values({ a: 1.5, b: 2.5 });
console.log(held.shift() + 1, held.pop() + 1);
console.log(held.length, held.pop() === undefined);
