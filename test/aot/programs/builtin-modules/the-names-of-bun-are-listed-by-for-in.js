// A for-in looks for each name that it hands out, and the host makes a member when it is first looked for. What makes the members of `Bun` is in the executable, so the walk ends as in plain Bun.
let count = 0;
for (const name in Bun) count++;
console.log(count > 3);
