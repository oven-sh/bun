const held = new Set().union(new Set([7, 1.5]));
for (const value of held) console.log(value + 1);
