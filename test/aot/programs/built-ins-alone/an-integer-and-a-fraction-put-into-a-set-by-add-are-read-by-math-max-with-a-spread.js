const held = new Set();
held.add(7);
held.add(1.5);
console.log(Math.max(...held) + 1, Math.min(...held) + 1);
