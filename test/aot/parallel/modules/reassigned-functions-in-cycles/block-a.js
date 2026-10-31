const made = [];
for (let i = 0; i < 2; i++) { function inBlock() { return i; } made.push(inBlock); if (i) inBlock = null; made.push(inBlock); }
console.log("block", made[0] === made[2], made[0](), made[1] === made[0], made[3]);
