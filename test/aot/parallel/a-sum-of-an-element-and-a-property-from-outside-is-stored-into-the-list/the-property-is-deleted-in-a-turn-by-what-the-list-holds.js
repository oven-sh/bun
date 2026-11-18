function run(d, dp, cap) { for (let k = 0; k < d.length; k++) { const item = d[k]; for (let w = cap; w >= item.w; w--) { const v = dp[w - item.w] + item.v; if (v > dp[w]) dp[w] = v; } } return dp; }
const rounds = +process.argv[2] || 3;
for (let r = 0; r < rounds; r++) { const D = JSON.parse('[{"w":3,"v":4.5},{"w":2,"v":1.5}]'); const dp = new Array(13 + r).fill(0); dp[5] = { valueOf() { delete D[1].v; D[1].w = 6; return 2; } }; console.log(run(D, dp, 12 + r).map(String).join(), JSON.stringify(D)); }
