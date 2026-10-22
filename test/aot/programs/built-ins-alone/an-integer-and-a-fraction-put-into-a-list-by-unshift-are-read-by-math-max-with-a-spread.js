const held = [];
held.unshift(1.5);
held.unshift(7);
console.log(Math.max(...held) + 1, Math.min(...held) + 1);
