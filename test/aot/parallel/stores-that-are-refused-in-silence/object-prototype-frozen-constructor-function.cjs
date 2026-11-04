Object.freeze(Object.prototype);
function Point(x) { this.x = x; this.toString = 0; this.valueOf = x; }
const p = new Point(3);
console.log(p.x, typeof p.toString, typeof p.valueOf, Object.keys(p).join());
