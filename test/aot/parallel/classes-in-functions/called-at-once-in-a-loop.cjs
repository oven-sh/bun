const made = [];
for (let k = 0; k < 3; k++) made.push((function () { function Point(x) { this.x = x + k; } Point.prototype.get = function () { return this.x * (k + 1); }; return Point; })());
function run(n) { const out = []; for (let i = 0; i < n; i++) for (const P of made) out.push(new P(i).get()); return out.join(" "); }
console.log(run(2), made[0] === made[1], new made[0](1) instanceof made[1]);
