const n = (value: number) => Number(process.argv[8] ?? value);
function run(limit: number) { let unread = 0; let sum = 0; for (let i = 0; i < limit; i++) { unread = i; sum += i; } return sum; }
console.log(run(n(5)), run(n(0)));
