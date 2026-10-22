const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? 7 : 1.5));
console.log(held.length);
console.log(held[0] + 1, held[1] + 1);
console.log(held[2] === undefined);
