// One expression is a chain of SIZE links: runs of sixteen `&&`, then of sixteen `||`, in parentheses so that each run is the left side of the next, and a `??` now and then.
// Where a left side goes at once hangs on the operators behind it. The program prints what the chain gives for every value of its three variables, as plain Bun does.
// It writes a program: SIZE says how long the chain is.
// Sizes: 1000 4000 16000
// Passes: 1
// Grows: the build, linear
// Room of the peak: 64 MB: a link of five bytes costs about 3 KB of the peak: 84 | 91 | 132 MB.
const size = Number(process.env.SIZE ?? 48);
let chain = "a";
for (let link = 0; link < size; link++) {
  const run = Math.floor(link / 16) % 5;
  const operator = run === 4 ? "??" : run % 2 ? "||" : "&&";
  const isFirstOfRun = link % 16 === 0;
  chain = `${isFirstOfRun ? `(${chain})` : chain} ${operator} ${"abc"[link % 3]}`;
}
console.log(
  `function f(a, b, c) { return ${chain}; }\nconst values = [0, 1, null, undefined, "", "x"];\nconst said = [];\n` +
    `for (const a of values) for (const b of values) for (const c of values) said.push(String(f(a, b, c)));\nconsole.log(said.join());`,
);
