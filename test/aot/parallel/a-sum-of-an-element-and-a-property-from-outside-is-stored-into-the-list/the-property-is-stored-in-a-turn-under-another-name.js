function run(d, dp, cap, other) { for (let k = 0; k < d.length; k++) { const item = d[k]; for (let w = cap; w >= item.w; w--) { const v = dp[w - item.w] + item.v; if (v > dp[w]) dp[w] = v; if (w == 9) other.v = other.v + 0.5; if (w == 6) other.w = 4; } } return dp; }
const rounds = +process.argv[2] || 3;
for (let r = 0; r < rounds; r++) { const D = JSON.parse('[{"w":3,"v":4.5},{"w":5,"v":7.25},{"w":2,"v":1.5}]'); console.log(run(D, new Array(13 + r).fill(0), 12 + r, D[1]).join(), JSON.stringify(D[1])); }
