const held = [];
held.unshift(2.5);
held.unshift(1.5);
console.log(Math.max(...held) + 1, Math.min(...held) + 1);
