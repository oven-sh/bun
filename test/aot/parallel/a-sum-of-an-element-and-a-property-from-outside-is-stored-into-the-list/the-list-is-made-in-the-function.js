// STATISTIC: WalkLoopsVersioned >= 1
// STATISTIC: SiteCachedReadsHoisted >= 1
function run(d, t) { const cap = 12 + (t & 3), dp = new Array(cap + 1).fill(0); for (const item of d) for (let w = cap; w >= item.w; w--) { const v = dp[w - item.w] + item.v; if (v > dp[w]) dp[w] = v; } return dp; }
const rounds = +process.argv[2] || 3;
const D = JSON.parse('[{"w":3,"v":4.5},{"w":5,"v":7.25},{"w":2,"v":1.5}]');
for (let r = 0; r < rounds; r++) console.log(run(D, r).join());
