const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? 1.5 : 2.5));
console.log(Math.max(...held) + 1, Math.min(...held) + 1);
