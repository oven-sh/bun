// Built ins assorted: crash d. It prints what plain Bun prints.
const x: unknown = Math.random() > 2 ? 1 : undefined;
console.log(typeof x);
console.log(1, typeof x);
