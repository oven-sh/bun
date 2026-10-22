// The host makes a member when it is first looked for, also by a test. What makes the members of `Bun` is in the executable, so the walk ends as in plain Bun.
let count = 0;
for (const name of Reflect.ownKeys(Bun)) if (Object.hasOwn(Bun, name)) count++;
console.log(count > 3);
