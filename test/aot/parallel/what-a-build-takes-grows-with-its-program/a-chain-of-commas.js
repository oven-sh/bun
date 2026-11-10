// One expression is a chain of SIZE commas. At each comma the front end asks whether the build removes the value on its left, which is the chain so far: it walked that chain
// anew at each comma, so 40,000 commas took 316 G instructions and 200,000 more time than a test file is given. Each expression is asked once now.
// It writes a program: SIZE says how long the chain is.
// Sizes: 2000 8000 32000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2);
console.log(`let a = 1;\nconst x = (a${", a".repeat(size)});\nconsole.log(x);`);
