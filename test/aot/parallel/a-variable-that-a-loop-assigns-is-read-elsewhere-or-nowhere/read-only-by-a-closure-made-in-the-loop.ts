const n = (value: number) => Number(process.argv[8] ?? value);
function run(limit: number) { let held = "none"; const readers: (() => string)[] = []; for (let i = 0; i < limit; i++) { held = "turn " + i; readers.push(() => held); } return readers.map(read => read()).join() + "|" + readers.length; }
console.log(run(n(3)), run(n(0)));
