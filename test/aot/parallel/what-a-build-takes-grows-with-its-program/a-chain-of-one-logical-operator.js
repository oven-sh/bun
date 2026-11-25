// One expression is a chain of SIZE `&&` over a variable. Where the left side of a link is falsy, control goes past all the `&&` behind it at once: where to was searched from each link
// to the end of the chain, so 200,000 links took 166 G instructions. It is worked out for all links in one pass from the end.
// It writes a program: SIZE says how long the chain is.
// Sizes: 1000 4000 16000
// Passes: 1
// Grows: the build, linear
const size = Number(process.env.SIZE ?? 2);
console.log(`let a = 1;\nconst x = a${" && a".repeat(size)};\nconsole.log(x);`);
