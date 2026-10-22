const held = new Set();
held.add("text");
held.add("more text");
for (const value of held) console.log(value.length);
