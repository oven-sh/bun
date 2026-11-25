function picky(a) { if (a === 7) throw new RangeError("seven"); return a + 1; }
function counts() { return arguments.length; }
function defaults(a, b = a * 2, ...rest) { return a + b + rest.length; }
const boundPicky = picky.bind(null), boundCounts = counts.bind(null), boundDefaults = defaults.bind(null);
function drive(turns) { let s = 0, caught = 0; for (let i = 0; i < turns; i++) { try { s += boundPicky(i % 9); } catch (error) { caught += error instanceof RangeError ? 1 : 100; } s += boundCounts(i, i, i) + boundCounts() + boundDefaults(i) + boundDefaults(i, 1, 2, 3); } return s + ":" + caught; }
console.log(drive(+(process.argv[2] ?? 50)));
