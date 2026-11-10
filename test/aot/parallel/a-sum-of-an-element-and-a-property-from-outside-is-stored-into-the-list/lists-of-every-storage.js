function run(d, dp, cap) { for (let k = 0; k < d.length; k++) { const item = d[k]; for (let w = cap; w >= item.w; w--) { const v = dp[w - item.w] + item.v; if (v > dp[w]) dp[w] = v; } } return dp; }
const rounds = +process.argv[2] || 3;
const D = JSON.parse('[{"w":3,"v":4.5},{"w":5,"v":7},{"w":2,"v":1.5}]');
const made = [n => new Array(n).fill(0), n => new Array(n).fill(0.5), n => new Array(n).fill("0"), n => new Array(n), n => Object.freeze(new Array(n).fill(0)), n => { const l = new Array(n).fill(0); l[n + 2000] = 1; return l; }];
for (let r = 0; r < rounds; r++) for (const make of made) { const dp = make(13 + r); let said; try { said = run(D, dp, 12 + r).slice(0, 16).join(); } catch (error) { said = error.constructor.name + " " + dp.slice(0, 16).join(); } console.log(said); }
