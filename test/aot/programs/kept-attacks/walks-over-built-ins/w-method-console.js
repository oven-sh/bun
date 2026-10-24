// Walks over built ins: w method console. It prints what plain Bun prints.
let count = 0;
for (const name of Reflect.ownKeys(console)) if (console.propertyIsEnumerable(name)) count++;
console.log(count > 3);
