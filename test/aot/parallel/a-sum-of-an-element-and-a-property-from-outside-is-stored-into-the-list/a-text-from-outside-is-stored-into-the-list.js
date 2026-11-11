// STATISTIC: WalkLoopsVersioned >= 1
const o = JSON.parse('{"name":"abc","k":3}');
function f(t) { const dp = new Array(64).fill(0); for (let i = 0; i < 64; i++) dp[i] = o.name; return dp[t & 63].length + dp.length; }
const rounds = +process.argv[2] || 3;
for (let r = 0; r < rounds; r++) console.log(f(r));
