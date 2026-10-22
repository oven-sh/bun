const held = new Set();
held.add(7);
held.add("text");
for (const value of held) console.log(typeof value, value);
