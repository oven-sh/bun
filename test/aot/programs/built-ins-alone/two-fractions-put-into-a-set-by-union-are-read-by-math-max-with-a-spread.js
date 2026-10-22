const held = new Set().union(new Set([1.5, 2.5]));
console.log(Math.max(...held) + 1, Math.min(...held) + 1);
