const n = (value) => Number(process.argv[8] ?? value);
function run(value, limit) { for (let i = 0; i < limit; i++) { value = i * 7; } return arguments[0]; }
console.log(run(n(-1), n(3)), run(n(-1), n(0)));
