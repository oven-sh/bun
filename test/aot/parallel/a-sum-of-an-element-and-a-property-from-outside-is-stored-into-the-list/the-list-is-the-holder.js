function run(d, dp, cap) { for (let k = 0; k < d.length; k++) { const item = d[k]; for (let w = cap; w >= item.w; w--) { const v = dp[w - item.w] + item.v; if (v > dp[w]) dp[w] = v; } } return dp; }
const rounds = +process.argv[2] || 3;
for (let r = 0; r < rounds; r++) { const dp = new Array(13 + r).fill(0); dp.w = 3; dp.v = 4.5; console.log(run([{ w: 2, v: 1.5 }, dp, { w: 5, v: 7.25 }], dp, 12 + r).join(), dp.w, dp.v); }
