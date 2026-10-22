const held = new Set();
held.add(1.5);
held.add(2.5);
console.log(Math.max(...held) + 1, Math.min(...held) + 1);
