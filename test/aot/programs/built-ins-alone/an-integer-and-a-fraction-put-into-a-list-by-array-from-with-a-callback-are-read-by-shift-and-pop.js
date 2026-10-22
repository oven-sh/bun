const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? 7 : 1.5));
console.log(held.shift() + 1, held.pop() + 1);
console.log(held.length, held.pop() === undefined);
