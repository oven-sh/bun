const n = (value: number) => Number(process.argv[8] ?? value);
function run(limit: number, stop: number) { let at = -1; let i = 0; while (true) { if (i >= limit) break; at = i; if (i === stop) break; i++; } return at; }
console.log(run(n(5), n(2)), run(n(5), n(9)), run(n(0), n(0)));
