// Walks over built ins: w spread. It prints what plain Bun prints.
const copy = { ...process };
console.log(typeof copy.pid, typeof copy.argv, Object.keys(copy).length > 10);
