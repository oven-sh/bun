const held = Object.values({ a: 1.5, b: 2.5 });
for (const [index, value] of held.entries()) console.log(index + 1, value + 1);
