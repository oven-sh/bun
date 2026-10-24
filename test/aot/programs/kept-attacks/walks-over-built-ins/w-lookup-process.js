// Walks over built ins: w lookup process. It prints what plain Bun prints.
let count = 0;
for (const name of Reflect.ownKeys(process)) if (process.__lookupGetter__(name) === undefined) count++;
console.log(count > 3);
