const held = Object.assign([], { 0: 1.5, 1: 2.5 });
for (const [index, value] of held.entries()) console.log(index + 1, value + 1);
