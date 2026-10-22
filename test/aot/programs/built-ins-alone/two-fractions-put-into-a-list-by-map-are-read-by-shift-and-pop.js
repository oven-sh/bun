const held = [0, 1].map(index => (index === 0 ? 1.5 : 2.5));
console.log(held.shift() + 1, held.pop() + 1);
console.log(held.length, held.pop() === undefined);
