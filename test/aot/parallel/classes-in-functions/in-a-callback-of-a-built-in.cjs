const made = [1, 2].map(function (k) { function Point(x) { this.x = x; } Point.prototype.get = function () { return this.x * k; }; return Point; });
function run(n) { const out = []; for (let i = 0; i < n; i++) for (const P of made) out.push(new P(i).get()); return out.join(" "); }
console.log(run(3), made[0] === made[1]);
