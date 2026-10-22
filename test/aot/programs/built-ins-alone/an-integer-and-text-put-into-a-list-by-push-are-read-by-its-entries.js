const held = [];
held.push(7);
held.push("text");
for (const [index, value] of held.entries()) console.log(index + 1, typeof value, value);
