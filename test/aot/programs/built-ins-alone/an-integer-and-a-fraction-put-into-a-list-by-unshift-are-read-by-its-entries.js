const held = [];
held.unshift(1.5);
held.unshift(7);
for (const [index, value] of held.entries()) console.log(index + 1, value + 1);
