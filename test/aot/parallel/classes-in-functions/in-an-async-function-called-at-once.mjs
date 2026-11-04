const Point = await (async () => { await 0; class Point { constructor(x) { this.x = x; } get() { return this.x; } } return Point; })();
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new Point(i).get(); return t; }
console.log(run(4));
