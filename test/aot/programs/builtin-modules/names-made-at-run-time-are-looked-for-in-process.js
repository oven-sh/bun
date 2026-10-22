// The host makes a member when it is first looked for, also by `in`. What makes the members of `process` is in the executable, so the walk ends as in plain Bun.
let count = 0;
for (const name of Object.getOwnPropertyNames(process)) if (name in process) count++;
console.log(count > 3);
