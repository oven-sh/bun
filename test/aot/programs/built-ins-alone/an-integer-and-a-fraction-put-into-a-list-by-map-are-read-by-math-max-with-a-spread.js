const held = [0, 1].map(index => (index === 0 ? 7 : 1.5));
console.log(Math.max(...held) + 1, Math.min(...held) + 1);
