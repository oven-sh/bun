// Each turn has a variable of its own.
function makers(...values) { const made = []; for (const value of values) made.push(() => value); return made; }
function run(n) { let t = 0; for (let i = 0; i < n; i++) for (const read of makers(i, 1, 2)) t += read(); return t; }
console.log(run(100), makers("a", "b").map(read => read()).join());
