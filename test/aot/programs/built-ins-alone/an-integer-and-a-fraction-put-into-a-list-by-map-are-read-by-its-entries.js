const held = [0, 1].map(index => (index === 0 ? 7 : 1.5));
for (const [index, value] of held.entries()) console.log(index + 1, value + 1);
