const held = new Set();
held.add(1.5);
held.add(undefined);
for (const value of held) console.log(typeof value, value);
