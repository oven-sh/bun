// A chain of SIZE commas goes over a variable and a constant in turn, behind a call. The effects of a read of the variable are unknown and those of the constant are known,
// so every second comma asks whether the build removes all that stands on its left. Each expression is asked once.
// It writes a program: SIZE says how long the chain is.
// Sizes: 2000 8000 32000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2);
console.log(`let calls = 0;\nfunction f() { calls++; }\nlet a = 1;\nconst c = 1;\nconst x = (f()${", a, c".repeat(size / 2)});\nconsole.log(x, calls);`);
