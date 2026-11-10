// A call stands in front of a chain of SIZE commas over a constant. The build cannot remove the call, so at each comma the question whether it removes the value on the left
// went down the whole chain to the call and heard no. Each expression is asked once now, and a no is kept as a yes is.
// It writes a program: SIZE says how long the chain is.
// Sizes: 2000 8000 32000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2);
console.log(`let calls = 0;\nfunction f() { calls++; }\nconst c = 1;\nconst x = (f()${", c".repeat(size)});\nconsole.log(x, calls);`);
