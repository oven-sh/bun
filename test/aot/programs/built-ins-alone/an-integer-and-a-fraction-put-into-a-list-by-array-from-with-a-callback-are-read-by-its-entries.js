const held = Array.from({ length: 2 }, (value, index) => (index === 0 ? 7 : 1.5));
for (const [index, value] of held.entries()) console.log(index + 1, value + 1);
