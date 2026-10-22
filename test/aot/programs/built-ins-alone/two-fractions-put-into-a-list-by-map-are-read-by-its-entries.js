const held = [0, 1].map(index => (index === 0 ? 1.5 : 2.5));
for (const [index, value] of held.entries()) console.log(index + 1, value + 1);
