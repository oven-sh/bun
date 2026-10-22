const held = [];
held.unshift(2.5);
held.unshift(1.5);
for (const [index, value] of held.entries()) console.log(index + 1, value + 1);
