// The host makes a member when it is first looked for, also by a test. What makes the members of `process` is in the executable, so the walk ends as in plain Bun.
let count = 0;
for (const name of Reflect.ownKeys(process)) if (Reflect.has(process, name)) count++;
console.log(count > 3);
