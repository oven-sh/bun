// The test reads the descriptor, and with it the value. What makes the members of `console` is in the executable, so the walk ends as in plain Bun.
let count = 0;
for (const name of Reflect.ownKeys(console)) if (Object.prototype.propertyIsEnumerable.call(console, name)) count++;
console.log(count > 3);
