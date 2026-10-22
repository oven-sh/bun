// Walks over built ins: w method bun. It prints what plain Bun prints.
let count = 0;
for (const name of Reflect.ownKeys(Bun)) if (Bun.hasOwnProperty(name)) count++;
console.log(count > 3);
