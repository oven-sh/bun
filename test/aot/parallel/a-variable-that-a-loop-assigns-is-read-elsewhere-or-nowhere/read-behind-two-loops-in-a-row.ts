const n = (value: number) => Number(process.argv[8] ?? value);
function run(first: number, second: number) { let mark = 0; for (let i = 0; i < first; i++) { mark = mark * 0 + i + 1; } for (let j = 0; j < second; j++) { mark = 10 + j; } return mark; }
console.log(run(n(3), n(0)), run(n(0), n(2)), run(n(2), n(2)), run(n(0), n(0)));
