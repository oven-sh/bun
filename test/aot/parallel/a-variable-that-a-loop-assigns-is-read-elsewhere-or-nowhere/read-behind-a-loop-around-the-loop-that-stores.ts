const n = (value: number) => Number(process.argv[8] ?? value);
function run(outer: number, inner: number) { let last = "none"; for (let i = 0; i < outer; i++) { for (let j = 0; j < inner; j++) { last = i + ":" + j; } } return last; }
console.log(run(n(2), n(3)), run(n(2), n(0)), run(n(0), n(3)));
