const held = new Set().add(1.5).add(2.5);
console.log(Math.max(...held) + 1, Math.min(...held) + 1);
