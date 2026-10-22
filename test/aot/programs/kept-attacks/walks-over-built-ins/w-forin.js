// Walks over built ins: w forin. It prints what plain Bun prints.
let count = 0;
for (const name in process) count++;
console.log(count > 10);
