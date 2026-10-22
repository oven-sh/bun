const held = new Set();
held.add(7);
held.add(8);
console.log(Math.max(...held) + 1, Math.min(...held) + 1);
