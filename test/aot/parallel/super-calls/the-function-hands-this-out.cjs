const seen = [];
function Base(a) { this.a = a; seen.push(this); }
class Below extends Base { constructor(a) { super(a); this.b = seen[seen.length - 1] === this; } }
function run(n) { let t = 0; for (let i = 0; i < n; i++) t += new Below(i).b ? 1 : 0; return t; }
console.log(run(4), seen.map(o => Object.keys(o).join("")).join(" "));
