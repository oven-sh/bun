const held = new Set().union(new Set([1.5, 2.5]));
for (const value of held) console.log(value + 1);
