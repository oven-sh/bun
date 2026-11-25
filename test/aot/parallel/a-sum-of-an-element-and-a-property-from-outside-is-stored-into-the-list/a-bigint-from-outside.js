function run(d, dp, cap) { for (let k = 0; k < d.length; k++) { const item = d[k]; for (let w = cap; w >= item.w; w--) { const v = dp[w - item.w] + item.v; if (v > dp[w]) dp[w] = v; } } return dp; }
const rounds = +process.argv[2] || 3;
const D = [{ w: 3, v: 4.5 }, { w: 2, v: 1n }];
for (let r = 0; r < rounds; r++) { let said; const dp = new Array(13 + r).fill(0); try { said = run(D, dp, 12 + r).join(); } catch (error) { said = error.constructor.name + " " + dp.join(); } console.log(said); }
