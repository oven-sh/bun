function run(d, dp, cap) { for (let k = 0; k < d.length; k++) { const item = d[k]; for (let w = cap; w >= item.w; w--) { const v = dp[w - item.w] + item.v; if (v > dp[w]) dp[w] = v; } } return dp; }
const rounds = +process.argv[2] || 3;
let calls = 0;
const D = [{ w: 3, v: 4.5 }, { w: 2, get v() { calls++; return 1.5; } }, { get w() { calls += 100; return 4; }, v: 2.5 }];
for (let r = 0; r < rounds; r++) console.log(run(D, new Array(13 + r).fill(0), 12 + r).join(), calls);
