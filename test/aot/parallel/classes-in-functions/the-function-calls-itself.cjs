const made = [];
(function again(depth) { function Point(x) { this.x = x; } Point.prototype.get = function () { return this.x + depth; }; made.push(Point); if (depth < 2) again(depth + 1); })(0);
function run(n) { const out = []; for (let i = 0; i < n; i++) for (const P of made) out.push(new P(i).get()); return out.join(" "); }
console.log(run(2), made.length, made[0] === made[1]);
