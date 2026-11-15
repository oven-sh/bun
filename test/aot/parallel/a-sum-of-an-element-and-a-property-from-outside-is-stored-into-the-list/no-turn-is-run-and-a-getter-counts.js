function run(d, dp, cap) { for (let k = 0; k < d.length; k++) { const item = d[k]; for (let w = cap; w >= item.w; w--) { const v = dp[w - item.w] + item.v; if (v > dp[w]) dp[w] = v; } } return dp; }
const rounds = +process.argv[2] || 3;
let asked = "";
const D = [{ w: 99, get v() { asked += "v"; return 1.5; } }, { get w() { asked += "w"; return 99; }, get v() { asked += "V"; return 2.5; } }, { w: 11, get v() { asked += "x"; return 3.5; } }];
for (let r = 0; r < rounds; r++) console.log(run(D, new Array(13 + r).fill(0), 12 + r).join(), asked);
