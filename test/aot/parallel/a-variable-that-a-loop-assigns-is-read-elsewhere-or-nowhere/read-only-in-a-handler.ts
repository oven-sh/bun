const n = (value: number) => Number(process.argv[8] ?? value);
function run(limit: number) { let step = -1; try { for (let i = 0; i < limit; i++) { step = i; if (i === n(3)) throw new Error("stop"); } return "whole"; } catch { return "stopped at " + step; } }
console.log(run(n(9)), run(n(2)), run(n(0)));
