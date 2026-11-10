// STATISTIC: HeadsThatAskBoundInVariable >= 1
const N = Number(process.argv[2] ?? "12"); let seen = 0;
const calls = [(x: number) => { seen += x; }][JSON.parse("0")];
function loud(): number { let s = 0; for (let i = 0; i < N; i++) { calls(i); s += i & 7; } return s; }
console.log(loud(), seen);
