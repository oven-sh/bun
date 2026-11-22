const n = (value: number) => Number(process.argv[8] ?? value);
async function run(limit: number) { let last = "none"; for (let i = 0; i < limit; i++) { last = "turn " + i; await null; } return last; }
console.log(await run(n(3)), await run(n(0)));
