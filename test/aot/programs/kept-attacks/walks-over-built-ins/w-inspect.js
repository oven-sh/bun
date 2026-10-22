// Walks over built ins: w inspect. It prints what plain Bun prints.
const text = Bun.inspect(process);
console.log(typeof text, text.length > 100);
