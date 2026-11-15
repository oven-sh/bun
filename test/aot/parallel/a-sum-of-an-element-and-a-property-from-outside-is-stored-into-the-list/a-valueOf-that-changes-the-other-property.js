function run(d, dp, cap) { for (let k = 0; k < d.length; k++) { const item = d[k]; for (let w = cap; w >= item.w; w--) { const v = dp[w - item.w] + item.v; if (v > dp[w]) dp[w] = v; } } return dp; }
const rounds = +process.argv[2] || 3;
for (let r = 0; r < rounds; r++) { let calls = 0; const item = { w: 2, v: { valueOf() { calls++; if (calls == 4) item.w = 5; return 1.5; } } }; console.log(run([{ w: 3, v: 4.5 }, item], new Array(13 + r).fill(0), 12 + r).join(), calls, item.w); }
