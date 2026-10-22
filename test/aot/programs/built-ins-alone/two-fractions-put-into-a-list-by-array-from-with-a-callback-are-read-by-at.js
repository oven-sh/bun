const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? 1.5 : 2.5));
console.log(held.at(0) + 1, held.at(-1) + 1);
