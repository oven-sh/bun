function run(d, dp, cap) { for (let k = 0; k < d.length; k++) { const item = d[k]; for (let w = cap; w >= item.w; w--) { const v = dp[w - item.w] + item.v; if (v > dp[w]) dp[w] = v; } } return dp; }
const rounds = +process.argv[2] || 3;
const seen = [];
const D = [{ w: 3, v: 4.5 }, new Proxy({ w: 2, v: 1.5 }, { get(target, key) { seen.push(String(key)); return target[key]; } })];
for (let r = 0; r < rounds; r++) console.log(run(D, new Array(9 + r).fill(0), 8 + r).join(), seen.length, seen.slice(0, 7).join());
