const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? 7 : 1.5));
for (const value of held) console.log(value + 1);
