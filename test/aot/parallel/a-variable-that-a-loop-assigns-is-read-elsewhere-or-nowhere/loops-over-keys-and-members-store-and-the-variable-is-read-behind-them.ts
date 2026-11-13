const n = (value: number) => Number(process.argv[8] ?? value);
function run(count: number) { const row: Record<string, number> = {}; for (let i = 0; i < count; i++) row["k" + i] = i; let key = "none"; for (const name in row) key = name; let member = -1; for (const value of Object.values(row)) member = value; return key + " " + member; }
console.log(run(n(3)), run(n(0)));
