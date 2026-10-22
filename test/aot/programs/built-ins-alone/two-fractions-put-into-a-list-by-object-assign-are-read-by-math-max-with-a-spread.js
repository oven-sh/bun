const held = Object.assign([], { 0: 1.5, 1: 2.5 });
console.log(Math.max(...held) + 1, Math.min(...held) + 1);
